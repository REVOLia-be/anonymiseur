/* Web Worker : MuPDF et son WASM ne touchent jamais le thread principal.
   L'interface reste fluide même sur un document de plusieurs dizaines de pages. */
import * as mupdf from "./mupdf-bridge.mjs";
import { anonymiser, verifier } from "./core.mjs";

const ECHELLE = 1.5;

function rendre(bytes, n = 0) {
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(n);
  const b = page.getBounds();
  const pix = page.toPixmap(mupdf.Matrix.scale(ECHELLE, ECHELLE), mupdf.ColorSpace.DeviceRGB, false, true);
  // .slice() : asPNG() aussi renvoie une vue sur le tas WASM. Sans copie, ce
  // PNG est détaché par les allocations suivantes et postMessage échoue.
  return { png: pix.asPNG().slice(), w: pix.getWidth(), h: pix.getHeight(),
           pageW: b[2] - b[0], pageH: b[3] - b[1] };
}

const etape = (n) => self.postMessage({ etape: n });

self.onmessage = (e) => {
  /* NB : ce gestionnaire n'existe qu'une fois les imports évalués (≈10 Mo de
     WASM). Tout message envoyé avant est PERDU, sans erreur : d'où le signal
     « prêt » ci-dessous, que le thread principal doit attendre. */
  const { bytes, mode } = e.data;
  try {
    etape("worker: message reçu");
    const src = new Uint8Array(bytes);
    const t0 = performance.now();
    etape("worker: rendu avant");
    const avant = rendre(src);
    const tRendu = performance.now() - t0;
    etape("worker: anonymisation");

    const t1 = performance.now();
    const { bytes: out, rapport } = anonymiser(src, { mode });
    const tAnon = performance.now() - t1;
    etape("worker: vérification");

    const t2 = performance.now();
    const { fuites } = verifier(out, rapport);
    const tVerif = performance.now() - t2;
    etape("worker: rendu après");

    const apres = rendre(out);
    etape("worker: envoi du résultat");

    self.postMessage({
      ok: true, rapport, fuites, echelle: ECHELLE,
      avant, apres, tailleEntree: src.length, tailleSortie: out.length,
      ms: { rendu: Math.round(tRendu), anon: Math.round(tAnon), verif: Math.round(tVerif) },
    });
  } catch (err) {
    self.postMessage({ ok: false, erreur: String((err && err.stack) || err) });
  }
};

// Signal de disponibilité : le thread principal attend ce message avant
// d'envoyer quoi que ce soit.
self.postMessage({ pret: true });
