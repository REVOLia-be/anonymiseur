/* Test de l'aperçu Word (js/apercu-docx.js) DANS UN NAVIGATEUR : rendu, pages
   virtuelles, index texte ↔ positions. Contrairement aux autres tests, celui-ci
   a besoin de Playwright (non vendoré, rien à installer dans le dépôt : à
   utiliser s'il est déjà présent sur la machine) et d'un serveur statique.

   Usage : node apercu-docx.cjs [http://127.0.0.1:4599]

   Fabrique un document LONG synthétique (≈ 10 pages, sans aucun saut de page,
   tableaux compris), l'ouvre, et vérifie : plusieurs pages ; aucun caractère
   coupé par le bord d'une page ; bornes et texte global cohérents ; un saut de
   ligne entre deux blocs ; temps de rendu, de pagination et d'indexation.
   Code de sortie 1 si échec. */
const d = require("../vendor/docx.umd.js");
const { chromium } = require("playwright");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = d;

const base = process.argv[2] || "http://127.0.0.1:4599";
const lorem = "Le prestataire s'engage à fournir les services décrits ci-après avec diligence. ";
(async () => {
  const enfants = [new Paragraph({ text: "Contrat cadre", heading: HeadingLevel.TITLE })];
  for (let a = 1; a <= 14; a++) {
    enfants.push(new Paragraph({ text: `Article ${a}`, heading: HeadingLevel.HEADING_2 }));
    enfants.push(new Paragraph({ children: [new TextRun(lorem.repeat(12)), new TextRun({ text: "Madame Sophie Vandenberghe", bold: true })] }));
    if (a % 3 === 0) enfants.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [1, 2, 3, 4, 5].map(i => new TableRow({ children: [`Atelier ${a}.${i} ${lorem}`, "11/06/2026", `${i * 250},00 €`]
        .map(t => new TableCell({ children: [new Paragraph(t)] })) })) }));
  }
  const octets = await Packer.toBuffer(new Document({ sections: [{ children: enfants }] }));

  const nav = await chromium.launch(), page = await nav.newPage();
  const erreurs = []; page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(base + "/index.html");
  const r = await page.evaluate(async (b64) => {
    const o = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const t = performance.now();
    const { vue, index, mesures } = await ApercuDocx.ouvrir(o, {});
    const mauvais = [];
    index.pages.forEach((pg, i) => {
      const w = pg.fenetre; let mn = 1e9, mx = 0;
      for (let k = 0; k < pg.texte.length; k++) {
        if (pg.sauts[k]) continue;
        const y0 = pg.quads[k * 8 + 1], y1 = pg.quads[k * 8 + 5];
        if (!(y1 > y0)) continue; mn = Math.min(mn, y0); mx = Math.max(mx, y1);
      }
      if (mn < w.decalage - 0.6 || mx > w.decalage + w.fin - w.debut + 0.6) mauvais.push(i);
    });
    const joint = index.pages.map(p => p.texte).join("\n\n");
    const res = { nPages: index.nPages, mauvais, mesures, ms: Math.round(performance.now() - t),
                  bornesOk: index.bornes.every((b, i) => index.texte.slice(b.debut, b.fin) === index.pages[i].texte),
                  jointOk: joint === index.texte,
                  sautEntreBlocs: /Vandenberghe\n(?:Article|Atelier)/.test(index.texte) };
    vue.fermer();
    return res;
  }, octets.toString("base64"));
  await nav.close();

  let echecs = 0;
  const verifie = (c, m) => { console.log((c ? "  ok " : "  ÉCHEC") + " " + m); if (!c) echecs++; };
  console.log(`${r.nPages} pages virtuelles, ${r.mesures.caracteres} caractères — rendu ${r.mesures.rendu} ms, pagination ${r.mesures.pagination} ms, index ${r.mesures.index} ms`);
  verifie(r.nPages >= 5, "le document sans saut de page est découpé en pages virtuelles");
  verifie(!r.mauvais.length, "aucun caractère coupé par le bord d'une page" + (r.mauvais.length ? " (pages " + r.mauvais + ")" : ""));
  verifie(r.bornesOk && r.jointOk, "bornes et texte global cohérents (pages jointes par \\n\\n)");
  verifie(r.sautEntreBlocs, "un saut de ligne entre deux paragraphes ou cellules");
  verifie(!erreurs.length, "aucune erreur JavaScript" + (erreurs.length ? " : " + erreurs[0] : ""));
  process.exit(echecs ? 1 : 0);
})();
