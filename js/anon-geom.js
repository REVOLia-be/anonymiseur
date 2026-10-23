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
      // 1 = saut de ligne (la ligne d'écriture s'arrête) ; 2 = espace inséré
      // entre deux mots reconnus (pas de géométrie, mais la ligne continue).
      if (sauts[i] === 1) { cur = null; continue; }
      if (sauts[i]) continue;
      const k = i * 8;
      const x0 = Math.min(quads[k],     quads[k + 4]);
      const y0 = Math.min(quads[k + 1], quads[k + 5]);
      const x1 = Math.max(quads[k + 2], quads[k + 6]);
      const y1 = Math.max(quads[k + 3], quads[k + 7]);
      if (!(x1 > x0) || !(y1 > y0)) continue;           // glyphe sans surface
      /* Même ligne d'écriture ? On ne compare pas les ordonnées à l'identique :
         l'OCR donne une boîte par MOT, et ces boîtes ne s'alignent jamais au
         point près. On exige un recouvrement vertical franc et un écart
         horizontal court — ce qui soude « 11 juin 2026 » en un seul rectangle
         sans jamais souder deux colonnes voisines. */
      if (cur) {
        const hCur = cur[3] - cur[1], hNouv = y1 - y0;
        const recouvre = Math.min(cur[3], y1) - Math.max(cur[1], y0);
        const ecart = x0 - cur[2];
        if (recouvre > 0.5 * Math.min(hCur, hNouv) && ecart < 0.6 * Math.max(hCur, hNouv)) {
          cur[0] = Math.min(cur[0], x0); cur[1] = Math.min(cur[1], y0);
          cur[2] = Math.max(cur[2], x1); cur[3] = Math.max(cur[3], y1);
          continue;
        }
      }
      cur = [x0, y0, x1, y1]; out.push(cur);
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
             origine: [page.origines[i * 2], page.origines[i * 2 + 1]],
             couleur: page.couleurs
               ? [page.couleurs[i * 3], page.couleurs[i * 3 + 1], page.couleurs[i * 3 + 2]]
               : null };
  }

  global.AnonGeom = { pageDe, rectsDansPage, rectsGlobaux, ancrage };
})(globalThis);
