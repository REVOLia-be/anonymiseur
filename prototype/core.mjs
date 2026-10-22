/* Cœur de l'anonymisation — aucune dépendance Node : tourne en Node ET dans
   un Web Worker. C'est ce fichier qui préfigure le module de production. */
import * as mupdf from "./mupdf-bridge.mjs";

export function buildIndex(page) {
  let text = "";
  const quads = [], origins = [], sizes = [];
  page.toStructuredText("preserve-whitespace").walk({
    onChar(c, origin, font, size, quad) {
      for (const _ of c) { quads.push(quad); origins.push(origin); sizes.push(size); }
      text += c;
    },
    endLine() { text += "\n"; quads.push(null); origins.push(null); sizes.push(null); },
  });
  return { text, quads, origins, sizes };
}

export function rectsFor(idx, start, end) {
  const out = []; let cur = null;
  for (let i = start; i < end; i++) {
    const q = idx.quads[i];
    if (!q) { cur = null; continue; }
    const r = [Math.min(q[0], q[4]), Math.min(q[1], q[5]), Math.max(q[2], q[6]), Math.max(q[3], q[7])];
    if (cur && Math.abs(r[1] - cur[1]) < 2) {
      cur[0] = Math.min(cur[0], r[0]); cur[1] = Math.min(cur[1], r[1]);
      cur[2] = Math.max(cur[2], r[2]); cur[3] = Math.max(cur[3], r[3]);
    } else { cur = r.slice(); out.push(cur); }
  }
  return out;
}

const REGLES = [
  { cat: "PERSONNE", re: /(?:Madame|Monsieur|M\.|Mme)[ \t]+[A-ZÀ-Ÿ][\wà-ÿ'-]+(?:[ \t]+[A-ZÀ-Ÿ][\wà-ÿ'-]+)*/g },
  { cat: "EMAIL",    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { cat: "NISS",     re: /\b\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}\b/g },
  { cat: "IBAN",     re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\b/g },
  { cat: "TEL",      re: /(?:\+|00)\s?\d{1,3}(?:[ .\-/]?\d){7,11}/g },
  { cat: "LIEU",     re: /\d{1,4}\s+(?:avenue|rue|boulevard|place)\s+[A-ZÀ-Ÿ][\wà-ÿ'-]+(?:[ \t]+(?:de|du|des|la|le)[ \t]+[A-ZÀ-Ÿ][\wà-ÿ'-]+)?/gi },
];

/* Jetons cohérents : une même valeur reçoit toujours le même jeton. */
export function detecter(text, memoire = new Map(), compteur = {}) {
  const hits = [];
  for (const { cat, re } of REGLES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) hits.push({ cat, start: m.index, end: m.index + m[0].length, value: m[0] });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const clean = []; let last = -1;
  for (const h of hits) if (h.start >= last) { clean.push(h); last = h.end; }
  for (const h of clean) {
    const cle = h.cat + "::" + h.value.toLowerCase().replace(/\s+/g, " ").trim();
    if (!memoire.has(cle)) {
      compteur[h.cat] = (compteur[h.cat] || 0) + 1;
      memoire.set(cle, `[${h.cat}_${compteur[h.cat]}]`);
    }
    h.token = memoire.get(cle);
  }
  return clean;
}

const echappe = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function largeur(font, s, size) {
  let w = 0;
  for (const ch of s) w += font.advanceGlyph(font.encodeCharacter(ch.codePointAt(0)));
  return w * size;
}

function prepareFont(doc, page) {
  const pageObj = page.getObject();
  let res = pageObj.getInheritable("Resources");
  if (res.isNull()) { res = doc.newDictionary(); pageObj.put("Resources", res); }
  let fonts = res.get("Font");
  if (fonts.isNull()) { fonts = doc.newDictionary(); res.put("Font", fonts); }
  const font = new mupdf.Font("Helvetica");
  fonts.put("AnonTok", doc.addSimpleFont(font, "Latin"));
  return font;
}

function ecrireJetons(doc, page, font, poses, hauteurPage) {
  let flux = "";
  for (const { rect, token, size, origin } of poses) {
    const dispo = rect[2] - rect[0];
    let corps = size;
    while (corps > 3 && largeur(font, token, corps) > dispo) corps -= 0.25;
    flux += `q BT /AnonTok ${corps.toFixed(2)} Tf 0.18 0.43 0.82 rg ` +
            `1 0 0 1 ${origin[0].toFixed(2)} ${(hauteurPage - origin[1]).toFixed(2)} Tm ` +
            `(${echappe(token)}) Tj ET Q\n`;
  }
  const extra = doc.addStream(flux, {});
  const pageObj = page.getObject();
  const contents = pageObj.get("Contents");
  if (contents.isArray()) contents.push(extra);
  else { const arr = doc.newArray(); arr.push(contents); arr.push(extra); pageObj.put("Contents", arr); }
}

export function anonymiser(bytes, { mode = "pseudo" } = {}) {
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  const rapport = [], memoire = new Map(), compteur = {};

  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const bounds = page.getBounds();
    const hauteurPage = bounds[3] - bounds[1];
    const idx = buildIndex(page);
    const hits = detecter(idx.text, memoire, compteur);
    if (!hits.length) continue;

    const poses = [];
    for (const h of hits) {
      const rects = rectsFor(idx, h.start, h.end);
      for (const r of rects) { const a = page.createAnnotation("Redact"); a.setRect(r); a.update(); }
      if (rects.length && mode === "pseudo")
        poses.push({ rect: rects[0], token: h.token, size: idx.sizes[h.start] || 10, origin: idx.origins[h.start] });
      rapport.push({ page: p, cat: h.cat, value: h.value, token: h.token, rects });
    }
    page.applyRedactions(mode === "redact",
      mupdf.PDFPage.REDACT_IMAGE_PIXELS,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_REMOVE);
    if (poses.length) ecrireJetons(doc, page, prepareFont(doc, page), poses, hauteurPage);
  }
  // garbage=compact : OBLIGATOIRE, sinon l'ancien flux de contenu reste en
  // objet orphelin dans le fichier et les données sont récupérables.
  /* .slice() OBLIGATOIRE : asUint8Array() renvoie une VUE sur le tas WASM.
     Toute allocation ultérieure (un simple rendu de page) fait grandir ce tas
     et DÉTACHE la vue — longueur 0, sans la moindre erreur. On copie aussitôt. */
  return { bytes: doc.saveToBuffer("compress,garbage=compact,sanitize=yes").asUint8Array().slice(), rapport };
}

/* Contrôle indépendant : le texte doit avoir disparu du texte extrait ET des
   octets bruts du document décompressé. */
export function verifier(sortie, rapport) {
  const doc = mupdf.PDFDocument.openDocument(sortie, "application/pdf");
  let texte = "";
  for (let p = 0; p < doc.countPages(); p++)
    texte += doc.loadPage(p).toStructuredText("preserve-whitespace").asText();
  const octets = doc.saveToBuffer("decompress").asUint8Array().slice();
  let brut = "";
  for (let i = 0; i < octets.length; i += 32768)
    brut += String.fromCharCode.apply(null, octets.subarray(i, i + 32768));
  const fuites = [];
  for (const h of rapport)
    if (texte.includes(h.value) || brut.includes(h.value)) fuites.push(h.value);
  return { fuites, texte };
}
