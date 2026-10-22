/* ===========================================================================
   Reprojection : d'une position dans le TEXTE vers un rectangle sur la PAGE.

   C'est la pièce qui manquait à l'outil. Jusqu'ici le PDF était aplati en
   texte et ses positions jetées ; la détection ne pouvait donc plus être
   montrée à sa place réelle, ni appliquée au document d'origine.

   Rien ici ne dépend de MuPDF ni du DOM : de simples calculs sur les
   tableaux typés produits par le worker.
   =========================================================================== */
(function (global) {
  "use strict";

  /* Page contenant un offset du texte global (-1 si l'offset tombe dans un
     séparateur entre deux pages). */
  function pageDe(bornes, offset) {
    for (let p = 0; p < bornes.length; p++)
      if (offset >= bornes[p].debut && offset < bornes[p].fin) return p;
    return -1;
  }

  /* Rectangles couvrant [debut, fin) DANS une page, un par ligne d'écriture :
     une détection à cheval sur deux lignes donne deux rectangles. */
  function rectsDansPage(page, debut, fin) {
    const { quads, sauts } = page;
    const out = [];
    let cur = null;
    for (let i = debut; i < fin; i++) {
      if (sauts[i]) { cur = null; continue; }          // saut de ligne : pas de géométrie
      const k = i * 8;
      const x0 = Math.min(quads[k],     quads[k + 4]);
      const y0 = Math.min(quads[k + 1], quads[k + 5]);
      const x1 = Math.max(quads[k + 2], quads[k + 6]);
      const y1 = Math.max(quads[k + 3], quads[k + 7]);
      if (!(x1 > x0) || !(y1 > y0)) continue;           // glyphe sans surface
      // même ligne si l'écart vertical est négligeable
      if (cur && Math.abs(y0 - cur[1]) < 2) {
        cur[0] = Math.min(cur[0], x0); cur[1] = Math.min(cur[1], y0);
        cur[2] = Math.max(cur[2], x1); cur[3] = Math.max(cur[3], y1);
      } else { cur = [x0, y0, x1, y1]; out.push(cur); }
    }
    return out;
  }

  /* Rectangles couvrant [debut, fin) du texte GLOBAL, regroupés par page.
     Une détection qui chevaucherait une frontière de page est découpée. */
  function rectsGlobaux(index, debut, fin) {
    const res = [];
    for (let p = 0; p < index.bornes.length; p++) {
      const b = index.bornes[p];
      const d = Math.max(debut, b.debut), f = Math.min(fin, b.fin);
      if (d >= f) continue;
      const rects = rectsDansPage(index.pages[p], d - b.debut, f - b.debut);
      if (rects.length) res.push({ page: p, rects, debut: d - b.debut, fin: f - b.debut });
    }
    return res;
  }

  /* Corps de police et origine de ligne au début d'une détection : nécessaires
     pour écrire le jeton à la bonne place, à la bonne taille. */
  function ancrage(index, offset) {
    const p = pageDe(index.bornes, offset);
    if (p < 0) return null;
    const page = index.pages[p];
    const i = offset - index.bornes[p].debut;
    if (page.sauts[i]) return null;
    return { page: p, corps: page.tailles[i],
             origine: [page.origines[i * 2], page.origines[i * 2 + 1]] };
  }

  global.AnonGeom = { pageDe, rectsDansPage, rectsGlobaux, ancrage };
})(typeof window !== "undefined" ? window : self);
