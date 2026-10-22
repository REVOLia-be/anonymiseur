/* ===========================================================================
   Worker PDF — fine couche de messages au-dessus de js/anon-pdf.js.
   Tient MuPDF et son WASM hors du thread principal : l'interface reste fluide
   même sur un document de plusieurs dizaines de pages.
   Le document n'est jamais envoyé nulle part : il vit ici, en mémoire.
   =========================================================================== */
import { ouvrir, indexer, rendre, anonymiser, verifier } from "./anon-pdf.js";

/* Octets d'ORIGINE conservés tels quels : toute anonymisation repart de là,
   le document ouvert pour l'affichage n'est jamais muté. */
let octetsOrigine = null, docOrigine = null;
let octetsResultat = null, docResultat = null;

function fermer(quoi) {
  if ((quoi === "tout" || quoi === "resultat") && docResultat) {
    try { docResultat.destroy(); } catch { /* déjà libéré */ }
    docResultat = null; octetsResultat = null;
  }
  if (quoi === "tout" && docOrigine) {
    try { docOrigine.destroy(); } catch { /* déjà libéré */ }
    docOrigine = null; octetsOrigine = null;
  }
}

function docDe(source) {
  const doc = source === "resultat" ? docResultat : docOrigine;
  if (!doc) throw new Error("aucun document " + (source === "resultat" ? "anonymisé" : "chargé"));
  return doc;
}

const ACTIONS = {
  charger(a) {
    fermer("tout");
    octetsOrigine = new Uint8Array(a.octets);
    docOrigine = ouvrir(octetsOrigine);
    const idx = indexer(docOrigine);
    const transferts = [];
    for (const pg of idx.pages)
      transferts.push(pg.quads.buffer, pg.origines.buffer, pg.tailles.buffer, pg.sauts.buffer);
    return { valeur: idx, transferts };
  },

  rendre(a) {
    const r = rendre(docDe(a.source), a.page, a.echelle || 1.5);
    return { valeur: r, transferts: [r.png.buffer] };
  },

  anonymiser(a) {
    if (!octetsOrigine) throw new Error("aucun document chargé");
    fermer("resultat");
    const r = anonymiser(octetsOrigine, a.consignes,
                         { mode: a.mode, valeurs: a.valeurs || [] });
    octetsResultat = r.octets;
    docResultat = ouvrir(octetsResultat);
    return { valeur: { taille: octetsResultat.length, tailleOrigine: octetsOrigine.length,
                       nPages: docResultat.countPages(),
                       liensRetires: r.liensRetires,
                       annotationsRetirees: r.annotationsRetirees } };
  },

  verifier(a) {
    if (!octetsResultat) throw new Error("aucun document anonymisé");
    return { valeur: verifier(octetsResultat, a.valeurs) };
  },

  // Les octets ne sont copiés vers le thread principal qu'au téléchargement.
  recupererResultat() {
    if (!octetsResultat) throw new Error("aucun document anonymisé");
    const copie = octetsResultat.slice();
    return { valeur: { octets: copie }, transferts: [copie.buffer] };
  },

  fermer() { fermer("tout"); return { valeur: true }; },
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

/* Ce worker est un module : son `onmessage` n'existe qu'après l'évaluation
   des imports (~10 Mo de WASM). Tout message reçu avant serait perdu SANS
   erreur — d'où ce signal, que le thread principal doit attendre. */
self.postMessage({ pret: true });
