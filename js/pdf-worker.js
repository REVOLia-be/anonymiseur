/* ===========================================================================
   Worker PDF — MuPDF (WebAssembly), 100 % local.
   Le document n'est jamais envoyé nulle part : il est chargé ici, en mémoire,
   dans un fil d'exécution séparé pour ne pas figer l'interface.

   Ce worker est le SEUL endroit qui parle à MuPDF. Il expose :
     · charger  → ouvre le PDF et renvoie l'index texte ↔ positions
     · rendre   → rend une page en PNG (aperçu, et OCR des PDF scannés)

   ⚠ Trois pièges vérifiés sur prototype, dont dépend la correction du code
     (voir prototype/README.md) :
     1. tout tampon rendu par MuPDF est une VUE sur le tas WASM : il faut le
        copier (.slice()) avant toute autre allocation, sinon il est détaché
        silencieusement (longueur 0) ;
     2. ce worker est un module : son `onmessage` n'existe qu'après
        l'évaluation des imports (~10 Mo de WASM). Tout message reçu avant est
        perdu sans erreur, d'où le signal « prêt » en fin de fichier ;
     3. la mémoire WASM n'est pas ramassée automatiquement : on appelle
        destroy() sur ce qu'on ouvre.
   =========================================================================== */
import * as mupdf from "../vendor/mupdf/mupdf.js";

/* Document courant : on le garde ouvert entre deux appels pour éviter de
   retransférer et de réouvrir le fichier à chaque opération. */
let docCourant = null;
let octetsCourants = null;

function fermerDocument() {
  if (docCourant) { try { docCourant.destroy(); } catch { /* déjà libéré */ } }
  docCourant = null;
  octetsCourants = null;
}

/* --- Index texte ↔ positions ---------------------------------------------
   Pour chaque caractère du texte de la page, on conserve son quad (4 points)
   et l'origine de sa ligne d'écriture. C'est ce qui permet, plus tard, de
   reprojeter une détection faite sur du texte vers un rectangle sur la page.

   Les tableaux sont typés et transférés sans copie vers le thread principal.
   Un saut de ligne occupe une position dans le texte mais n'a pas de
   géométrie : il est marqué dans `saut`. */
function indexerPage(page) {
  let texte = "";
  const quads = [], origines = [], tailles = [], sauts = [];

  const stext = page.toStructuredText("preserve-whitespace,preserve-spans");
  try {
    stext.walk({
      onChar(c, origine, _police, corps, quad) {
        // un caractère hors BMP compte pour deux unités JS : on aligne
        for (const _ of c) {
          quads.push(quad[0], quad[1], quad[2], quad[3], quad[4], quad[5], quad[6], quad[7]);
          origines.push(origine[0], origine[1]);
          tailles.push(corps);
          sauts.push(0);
        }
        texte += c;
      },
      endLine() {
        texte += "\n";
        quads.push(0, 0, 0, 0, 0, 0, 0, 0);
        origines.push(0, 0);
        tailles.push(0);
        sauts.push(1);
      },
    });
  } finally { stext.destroy(); }

  return {
    texte,
    quads: new Float32Array(quads),
    origines: new Float32Array(origines),
    tailles: new Float32Array(tailles),
    sauts: new Uint8Array(sauts),
  };
}

function charger(octets) {
  fermerDocument();
  octetsCourants = octets;
  docCourant = mupdf.PDFDocument.openDocument(octets, "application/pdf");

  const pages = [];
  const bornes = [];
  let texte = "";

  for (let p = 0; p < docCourant.countPages(); p++) {
    const page = docCourant.loadPage(p);
    try {
      const b = page.getBounds();
      const idx = indexerPage(page);
      // Les pages sont séparées par une ligne vide, comme dans la version
      // précédente de l'outil. Ces 2 caractères n'appartiennent à aucune page.
      const debut = texte.length;
      texte += idx.texte;
      bornes.push({ debut, fin: texte.length });
      if (p < docCourant.countPages() - 1) texte += "\n\n";
      pages.push({ ...idx, largeur: b[2] - b[0], hauteur: b[3] - b[1] });
    } finally { page.destroy(); }
  }

  const transferts = [];
  for (const pg of pages)
    transferts.push(pg.quads.buffer, pg.origines.buffer, pg.tailles.buffer, pg.sauts.buffer);

  return { valeur: { texte, pages, bornes, nPages: pages.length }, transferts };
}

function rendre(n, echelle) {
  if (!docCourant) throw new Error("aucun document chargé");
  const page = docCourant.loadPage(n);
  try {
    const pix = page.toPixmap(
      mupdf.Matrix.scale(echelle, echelle), mupdf.ColorSpace.DeviceRGB, false, true);
    try {
      // .slice() : asPNG() renvoie une vue sur le tas WASM (piège nº1)
      const png = pix.asPNG().slice();
      return { valeur: { png, largeur: pix.getWidth(), hauteur: pix.getHeight() },
               transferts: [png.buffer] };
    } finally { pix.destroy(); }
  } finally { page.destroy(); }
}

/* --- Protocole ------------------------------------------------------------ */
const ACTIONS = {
  charger: (a) => charger(new Uint8Array(a.octets)),
  rendre:  (a) => rendre(a.page, a.echelle || 1.5),
  fermer:  () => { fermerDocument(); return { valeur: true }; },
};

self.onmessage = (e) => {
  const { id, action } = e.data;
  try {
    const fn = ACTIONS[action];
    if (!fn) throw new Error("action inconnue : " + action);
    const { valeur, transferts } = fn(e.data);
    self.postMessage({ id, ok: true, valeur }, transferts || []);
  } catch (err) {
    self.postMessage({ id, ok: false, erreur: String((err && err.message) || err) });
  }
};

// Piège nº2 : signaler la disponibilité une fois le WASM évalué. Le thread
// principal doit attendre ce message avant d'envoyer quoi que ce soit.
self.postMessage({ pret: true });
