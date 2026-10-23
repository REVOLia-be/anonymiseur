/* Test de bout en bout des modules de PRODUCTION (js/anon-pdf.js et
   js/anon-geom.js), hors navigateur. Détection minimale : on éprouve ici la
   chaîne index → géométrie → caviardage → vérification, pas la qualité des
   règles de détection.

   Usage : node chaine.mjs <fichier.pdf> [pseudo|redact] */
import { ouvrir, indexer, anonymiser, verifier } from "../js/anon-pdf.js";
import "../js/anon-geom.js";                    // installe globalThis.AnonGeom
import { readFileSync, writeFileSync } from "node:fs";

const REGLES = [
  { cat: "EMAIL",    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { cat: "IBAN",     re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\b/g },
  { cat: "NISS",     re: /\b\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}\b/g },
  { cat: "TEL",      re: /(?:\+|00)\s?\d{1,3}(?:[ .\-/]?\d){7,11}/g },
  { cat: "PERSONNE", re: /(?:Madame|Monsieur|Mme|M\.)[ \t]+[A-ZÀ-Ÿ][\wà-ÿ'-]+(?:[ \t]+[A-ZÀ-Ÿ][\wà-ÿ'-]+)*/g },
  { cat: "MONTANT",  re: /\b\d{1,3}(?:[ .]\d{3})*(?:,\d{2})?\s?(?:€|EUR)/g },
];

const fichier = process.argv[2];
const mode = process.argv[3] || "pseudo";
if (!fichier) { console.error("usage : node chaine.mjs <fichier.pdf> [pseudo|redact]"); process.exit(2); }

const octets = new Uint8Array(readFileSync(fichier));
const doc = ouvrir(octets);
const index = indexer(doc);
console.log(`${index.nPages} page(s), ${index.texte.length} caractères`);

// détection + jetons cohérents
const hits = [];
for (const { cat, re } of REGLES) {
  re.lastIndex = 0; let m;
  while ((m = re.exec(index.texte))) hits.push({ cat, debut: m.index, fin: m.index + m[0].length, valeur: m[0] });
}
hits.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
const propres = []; let dernier = -1;
for (const h of hits) if (h.debut >= dernier) { propres.push(h); dernier = h.fin; }
const memoire = new Map(), compteur = {};
for (const h of propres) {
  const cle = h.cat + "::" + h.valeur.toLowerCase().replace(/\s+/g, " ").trim();
  if (!memoire.has(cle)) { compteur[h.cat] = (compteur[h.cat] || 0) + 1; memoire.set(cle, `[${h.cat}_${compteur[h.cat]}]`); }
  h.token = memoire.get(cle);
}

// géométrie → consignes
const consignes = [];
let sansZone = 0;
for (const h of propres) {
  const groupes = AnonGeom.rectsGlobaux(index, h.debut, h.fin);
  if (!groupes.length) { sansZone++; continue; }
  const anc = AnonGeom.ancrage(index, h.debut);
  for (const g of groupes)
    consignes.push({ page: g.page, rects: g.rects, token: h.token,
                     corps: anc && anc.corps, origine: anc && anc.origine,
                     couleur: anc && anc.couleur });
}
console.log(`${propres.length} détection(s), ${consignes.length} consigne(s), ${sansZone} sans zone`);

const t0 = Date.now();
const rapport = anonymiser(octets, consignes, { mode, valeurs: propres.map(h => h.valeur) });
const resultat = rapport.octets;
const ms = Date.now() - t0;

const { fuites, nVerifiees } = verifier(resultat, propres.map(h => h.valeur));
const sortie = fichier.replace(/\.pdf$/i, `-anon-${mode}.pdf`);
writeFileSync(sortie, resultat);

console.log(`${octets.length} → ${resultat.length} octets (${(resultat.length / octets.length).toFixed(2)}×) en ${ms} ms`);
console.log(`liens retirés : ${rapport.liensRetires} · annotations retirées : ${rapport.annotationsRetirees}`);
console.log(`vérification : ${nVerifiees} valeur(s) contrôlée(s) — ${fuites.length ? "FUITES : " + fuites.join(", ") : "aucune fuite ✅"}`);
console.log("écrit :", sortie);
for (const h of propres) console.log(`   ${h.token.padEnd(14)} ${JSON.stringify(h.valeur).slice(0, 60)}`);
process.exit(fuites.length ? 1 : 0);
