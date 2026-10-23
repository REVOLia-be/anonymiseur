/* ===========================================================================
   Opérations PDF — MuPDF (WebAssembly). 100 % local.

   Module isolé du worker pour être testable directement (Node ou navigateur) :
   aucune dépendance au DOM ni au protocole de messages.

   ⚠ Trois règles vérifiées sur prototype, dont dépend la correction du code
     (voir prototype/README.md) :
     1. tout tampon rendu par MuPDF est une VUE sur le tas WASM : le copier
        (.slice()) avant toute autre allocation, sinon il est détaché
        silencieusement (longueur 0) ;
     2. « garbage=compact » à la sauvegarde est une exigence de SÉCURITÉ :
        sans lui, l'ancien flux de contenu reste dans le fichier en objet
        orphelin et les données caviardées restent récupérables ;
     3. la mémoire WASM n'est pas ramassée automatiquement : destroy().
   =========================================================================== */
import * as mupdf from "../vendor/mupdf/mupdf.js";

/* Options de sauvegarde — ne pas alléger : voir règle nº2. */
const SAUVEGARDE = "compress,garbage=compact,sanitize=yes";

/* --- Index texte ↔ positions ---------------------------------------------
   Pour chaque caractère du texte, on conserve son quad et l'origine de sa
   ligne d'écriture : c'est ce qui permet de reprojeter une détection faite
   sur du texte vers un rectangle sur la page.

   « preserve-spans » est volontairement ABSENT : sur les PDF exportés depuis
   un outil de mise en page (polices Type3), cette option émet une ligne par
   fragment et hache le texte en caractères isolés. */
function indexerPage(page) {
  let texte = "";
  const quads = [], origines = [], tailles = [], sauts = [], couleurs = [];
  const stext = page.toStructuredText("preserve-whitespace");
  try {
    stext.walk({
      // `couleur` : la teinte du texte d'origine. Le jeton la reprendra, pour
      // rester lisible sur un fond sombre comme sur un fond clair.
      onChar(c, origine, _police, corps, quad, couleur) {
        const [r, v, b] = couleur || [0, 0, 0];
        for (const _ of c) {               // un caractère hors BMP = 2 unités JS
          quads.push(quad[0], quad[1], quad[2], quad[3], quad[4], quad[5], quad[6], quad[7]);
          origines.push(origine[0], origine[1]);
          tailles.push(corps);
          couleurs.push(r, v, b);
          sauts.push(0);
        }
        texte += c;
      },
      endLine() {
        texte += "\n";
        quads.push(0, 0, 0, 0, 0, 0, 0, 0);
        origines.push(0, 0); tailles.push(0); couleurs.push(0, 0, 0); sauts.push(1);
      },
    });
  } finally { stext.destroy(); }
  return { texte,
    quads: new Float32Array(quads), origines: new Float32Array(origines),
    tailles: new Float32Array(tailles), couleurs: new Float32Array(couleurs),
    sauts: new Uint8Array(sauts) };
}

export function indexer(doc) {
  const pages = [], bornes = [];
  let texte = "";
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    try {
      const b = page.getBounds();
      const idx = indexerPage(page);
      const debut = texte.length;
      texte += idx.texte;
      bornes.push({ debut, fin: texte.length });
      if (p < doc.countPages() - 1) texte += "\n\n";   // séparateur de pages
      pages.push({ ...idx, largeur: b[2] - b[0], hauteur: b[3] - b[1] });
    } finally { page.destroy(); }
  }
  return { texte, pages, bornes, nPages: pages.length };
}

export function rendre(doc, n, echelle) {
  const page = doc.loadPage(n);
  try {
    const pix = page.toPixmap(
      mupdf.Matrix.scale(echelle, echelle), mupdf.ColorSpace.DeviceRGB, false, true);
    try {
      return { png: pix.asPNG().slice(),      // règle nº1
               largeur: pix.getWidth(), hauteur: pix.getHeight() };
    } finally { pix.destroy(); }
  } finally { page.destroy(); }
}

/* --- Écriture des jetons --------------------------------------------------
   Le jeton devient du VRAI contenu de page (et non une annotation) : il est
   donc sélectionnable, copiable, et lu par une IA comme n'importe quel texte.
   Une annotation, elle, peut être ignorée à l'extraction ou supprimée. */
function preparerPolice(doc, page) {
  const obj = page.getObject();
  let res = obj.getInheritable("Resources");
  if (res.isNull()) { res = doc.newDictionary(); obj.put("Resources", res); }
  let polices = res.get("Font");
  if (polices.isNull()) { polices = doc.newDictionary(); res.put("Font", polices); }
  const police = new mupdf.Font("Helvetica");
  polices.put("AnonTok", doc.addSimpleFont(police, "Latin"));
  return police;
}

const echapper = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function largeurTexte(police, s, corps) {
  let w = 0;
  for (const ch of s) w += police.advanceGlyph(police.encodeCharacter(ch.codePointAt(0)));
  return w * corps;
}

function ecrireJetons(doc, page, police, poses, hauteurPage) {
  let flux = "";
  for (const { rect, token, corps, origine, couleur } of poses) {
    const dispo = rect[2] - rect[0];
    const depart = corps || 10;
    let taille = depart;
    // Le jeton doit tenir dans l'espace libéré : on réduit le corps au besoin,
    // mais jamais en dessous d'un plancher. Un jeton de 3 pt « tient » et ne
    // se lit pas ; mieux vaut un léger débord qu'un texte microscopique.
    const plancher = Math.max(5, depart * 0.55);
    while (taille > plancher && largeurTexte(police, token, taille) > dispo) taille -= 0.25;
    const x = origine[0];
    const y = hauteurPage - origine[1];    // index : y vers le bas ; PDF : y vers le haut
    // Couleur du texte remplacé : un jeton bleu sur un bandeau vert foncé
    // était illisible.
    const [r, v, b] = couleur || [0.18, 0.43, 0.82];
    flux += `q BT /AnonTok ${taille.toFixed(2)} Tf ${r.toFixed(3)} ${v.toFixed(3)} ${b.toFixed(3)} rg ` +
            `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${echapper(token)}) Tj ET Q\n`;
  }
  const extra = doc.addStream(flux, {});
  const obj = page.getObject();
  const contenus = obj.get("Contents");
  if (contenus.isArray()) contenus.push(extra);
  else { const arr = doc.newArray(); arr.push(contenus); arr.push(extra); obj.put("Contents", arr); }
}

/* --- Nettoyage des liens et annotations -----------------------------------
   Caviarder le texte ne suffit pas : un e-mail, un téléphone ou une URL
   restent dans le fichier s'ils sont aussi portés par une ANNOTATION DE LIEN
   (« mailto:… »). Les outils de mise en page créent ces liens
   automatiquement, et MuPDF ne les touche pas au caviardage.
   Constaté en vrai sur un devis : l'adresse disparaissait de la page et
   restait cliquable. */
function seChevauchent(a, b) {
  return !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
}

function nettoyerLiens(page, rects, valeurs) {
  const aSupprimer = [];
  for (const lien of page.getLinks()) {
    const uri = lien.getURI() || "";
    const expose = valeurs.some(v => v && v.length >= 3 && uri.includes(v));
    const couvert = rects.some(r => seChevauchent(r, lien.getBounds()));
    if (expose || couvert) aSupprimer.push(lien);
  }
  for (const l of aSupprimer) {
    // Neutraliser l'URI AVANT de supprimer le lien. Supprimer seul ne suffit
    // pas : l'objet d'annotation survit au ramasse-miettes tant que l'arbre
    // de structure du document (PDF balisé) le référence, et « mailto:… »
    // reste alors dans le fichier. Vérifié sur un document réel.
    // L'URI doit rester syntaxiquement valide — la chaîne vide est refusée.
    try { l.setURI("about:blank"); } catch { /* lien interne, sans URI */ }
    page.deleteLink(l);
  }
  return aSupprimer.length;
}

/* Une annotation posée sur une zone caviardée (champ de formulaire rempli,
   commentaire, tampon) peut en conserver le contenu : on la retire. */
function nettoyerAnnotations(page, rects) {
  if (!rects.length) return 0;
  const aSupprimer = [];
  for (const a of page.getAnnotations()) {
    let r;
    try { r = a.getRect(); } catch { continue; }
    if (rects.some(z => seChevauchent(z, r))) aSupprimer.push(a);
  }
  for (const a of aSupprimer) page.deleteAnnotation(a);
  return aSupprimer.length;
}

/* Un PDF balisé porte une COUCHE DE TEXTE PARALLÈLE, destinée aux lecteurs
   d'écran : texte alternatif d'une image (/Alt), texte réel d'un élément
   (/ActualText), développement d'une abréviation (/E), infobulle d'un champ
   (/TU). Rien de tout cela n'est
   dessiné sur la page : le caviardage ne les touche pas, et pourtant un
   extracteur les lit.
   Constaté en vrai : le logo d'un devis portait Alt(REVOLia) ; l'alt d'une
   photo peut tout aussi bien être le nom de la personne. */
const CLES_TEXTE_CACHE = ["Alt", "ActualText", "E", "TU"];

/* On descend l'ARBRE DE STRUCTURE, et lui seul. Un balayage de tous les
   objets du document paraît plus sûr ; il ne l'est pas : résoudre puis
   modifier des objets au hasard a fait perdre un mégaoctet d'images au
   fichier produit (2 204 774 → 1 210 665 octets) et l'a rendu illisible par
   endroits. On ne touche donc qu'aux nœuds de structure. */
function nettoyerTexteCache(doc, valeurs) {
  const utiles = valeurs.filter(v => v && v.length >= 3);
  if (!utiles.length) return 0;
  let n = 0;
  const vus = new Set();                       // l'arbre peut contenir des cycles

  const visiter = (ref, profondeur) => {
    if (!ref || ref.isNull() || profondeur > 64) return;
    if (ref.isIndirect()) {
      const num = ref.asIndirect();
      if (vus.has(num)) return;
      vus.add(num);
    }
    const obj = ref.resolve();
    if (obj.isArray()) { obj.forEach(v => visiter(v, profondeur + 1)); return; }
    if (!obj.isDictionary()) return;
    for (const k of CLES_TEXTE_CACHE) {
      const val = obj.get(k);
      if (val.isNull() || !val.isString()) continue;
      let s;
      try { s = val.asString(); } catch { continue; }
      if (s && utiles.some(v => s.includes(v))) { obj.delete(k); n++; }
    }
    visiter(obj.get("K"), profondeur + 1);
    visiter(obj.get("Kids"), profondeur + 1);
  };

  try { visiter(doc.getTrailer().get("Root").get("StructTreeRoot"), 0); }
  catch { /* document non balisé : rien à nettoyer */ }
  return n;
}

/* Les SIGNETS forment encore une autre couche de texte : le titre d'un
   signet n'est pas dessiné sur la page, le caviardage ne le touche pas, et
   un lecteur de PDF l'affiche dans son panneau de navigation. Un export
   Word en crée un par titre de section — « Dossier Madame X » y survivait
   intact. On remplace le titre plutôt que de le supprimer, pour ne pas
   casser l'arborescence. */
function nettoyerSignets(doc, utiles) {
  if (!utiles.length) return 0;
  let n = 0;
  const vus = new Set();

  const visiter = (ref, profondeur) => {
    // les frères se parcourent en boucle : une table des matières longue
    // ferait déborder la pile en récursion.
    while (ref && !ref.isNull() && profondeur <= 64) {
      if (ref.isIndirect()) {
        const num = ref.asIndirect();
        if (vus.has(num)) return;
        vus.add(num);
      }
      const obj = ref.resolve();
      if (!obj.isDictionary()) return;
      const titre = obj.get("Title");
      if (!titre.isNull() && titre.isString()) {
        let s;
        try { s = titre.asString(); } catch { s = null; }
        if (s && utiles.some(v => s.includes(v))) {
          obj.put("Title", doc.newString("[masqué]"));
          n++;
        }
      }
      visiter(obj.get("First"), profondeur + 1);
      ref = obj.get("Next");
    }
  };

  try { visiter(doc.getTrailer().get("Root").get("Outlines"), 0); }
  catch { /* document sans signets */ }
  return n;
}

/* Métadonnées : titre, auteur, logiciel et machine d'origine. Elles ne
   s'affichent pas mais voyagent avec le fichier. */
function nettoyerMetadonnees(doc) {
  for (const k of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) {
    try { doc.setMetaData("info:" + k, ""); } catch { /* clé absente */ }
  }
  try {
    const root = doc.getTrailer().get("Root");
    if (!root.get("Metadata").isNull()) root.delete("Metadata");   // bloc XMP
  } catch { /* pas de XMP */ }
}

/* --- Anonymisation --------------------------------------------------------
   `consignes` : [{ page, rects, token, corps, origine }] — produites par
   l'interface à partir des détections validées par l'utilisateur. La
   détection elle-même n'a pas sa place ici.

   `valeurs` : les textes anonymisés en clair, utilisés uniquement pour
   repérer les liens qui les exposeraient.

   `mode` : "pseudo" (jeton à la place) ou "redact" (barre noire). */
export function anonymiser(octetsOrigine, consignes, opts = {}) {
  const { mode = "pseudo", valeurs = [], nettoyerMeta = true } = opts;
  // On repart TOUJOURS des octets d'origine : le document ouvert pour
  // l'affichage ne doit jamais être muté.
  const doc = mupdf.PDFDocument.openDocument(octetsOrigine, "application/pdf");
  try {
    const parPage = new Map();
    for (const c of consignes) {
      if (!parPage.has(c.page)) parPage.set(c.page, []);
      parPage.get(c.page).push(c);
    }

    let liensRetires = 0, annotationsRetirees = 0;

    // Toutes les pages sont parcourues, même sans consigne : un lien peut
    // exposer, depuis n'importe quelle page, une valeur masquée ailleurs.
    for (let n = 0; n < doc.countPages(); n++) {
      const page = doc.loadPage(n);
      try {
        const liste = parPage.get(n) || [];
        const rects = liste.flatMap(c => c.rects);

        liensRetires += nettoyerLiens(page, rects, valeurs);
        annotationsRetirees += nettoyerAnnotations(page, rects);
        if (!liste.length) continue;

        const b = page.getBounds();
        const poses = [];
        for (const c of liste) {
          for (const r of c.rects) {
            const annot = page.createAnnotation("Redact");
            annot.setRect(r);
            annot.update();
          }
          if (mode === "pseudo" && c.rects.length && c.origine)
            poses.push({ rect: c.rects[0], token: c.token, corps: c.corps,
                         origine: c.origine, couleur: c.couleur });
        }
        // Options choisies pour PRÉSERVER la mise en page :
        // - REDACT_IMAGE_PIXELS : ne remplace que les pixels couverts,
        //   au lieu de supprimer l'image entière ;
        // - REDACT_LINE_ART_NONE : ne supprime pas les tracés vectoriels
        //   (bordures de tableau, filets) traversés par une zone.
        page.applyRedactions(
          mode === "redact",
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_NONE,
          mupdf.PDFPage.REDACT_TEXT_REMOVE);

        if (poses.length)
          ecrireJetons(doc, page, preparerPolice(doc, page), poses, b[3] - b[1]);
      } finally { page.destroy(); }
    }

    const textesCaches = nettoyerTexteCache(doc, valeurs);
    const signetsNettoyes = nettoyerSignets(doc, valeurs.filter(v => v && v.length >= 3));
    if (nettoyerMeta) nettoyerMetadonnees(doc);

    return {
      octets: doc.saveToBuffer(SAUVEGARDE).asUint8Array().slice(),  // règles nº1 et nº2
      liensRetires, annotationsRetirees, textesCaches, signetsNettoyes,
    };
  } finally { doc.destroy(); }
}

/* --- Vérification ---------------------------------------------------------
   Contrôle indépendant du résultat : chaque valeur anonymisée est cherchée
   dans le texte extrait ET dans les octets bruts du document décompressé.
   C'est ce second contrôle qui attrape les données survivant dans un objet
   que la page ne référence plus. */
export function verifier(octetsResultat, valeurs) {
  const doc = mupdf.PDFDocument.openDocument(octetsResultat, "application/pdf");
  try {
    // Texte page par page : savoir OÙ une mention subsiste change tout.
    // Dans le texte d'une page, n'importe qui la lit ; ailleurs dans le
    // fichier (signet, pièce jointe, couche), c'est un autre sujet.
    const parPage = [];
    let texte = "";
    for (let p = 0; p < doc.countPages(); p++) {
      const page = doc.loadPage(p);
      try {
        const st = page.toStructuredText("preserve-whitespace");
        try { parPage.push(st.asText()); } finally { st.destroy(); }
      } finally { page.destroy(); }
      texte += parPage[p];
    }
    const octets = doc.saveToBuffer("decompress").asUint8Array().slice();
    let brut = "";
    for (let i = 0; i < octets.length; i += 32768)
      brut += String.fromCharCode.apply(null, octets.subarray(i, i + 32768));

    const fuites = [], details = [];
    for (const v of new Set(valeurs)) {
      if (!v || v.length < 3) continue;          // trop court pour être concluant
      const pages = [];
      for (let p = 0; p < parPage.length; p++) if (parPage[p].includes(v)) pages.push(p + 1);
      const dansOctets = brut.includes(v);
      if (!pages.length && !dansOctets) continue;
      fuites.push(v);
      details.push({ valeur: v, pages, dansOctets, visible: pages.length > 0 });
    }
    return { fuites, details, nVerifiees: new Set(valeurs).size };
  } finally { doc.destroy(); }
}

export function ouvrir(octets) {
  return mupdf.PDFDocument.openDocument(octets, "application/pdf");
}
