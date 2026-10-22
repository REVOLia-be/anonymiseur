/* Vérification en ligne de commande — même cœur que le navigateur.
   Usage : node cli.mjs <fichier.pdf> [pseudo|redact] */
import { anonymiser, verifier } from "./core.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const entree = process.argv[2];
const mode = process.argv[3] || "pseudo";
if (!entree) { console.error("usage : node cli.mjs <fichier.pdf> [pseudo|redact]"); process.exit(2); }

const src = new Uint8Array(readFileSync(entree));
const t0 = Date.now();
const { bytes, rapport } = anonymiser(src, { mode });
const ms = Date.now() - t0;
const { fuites } = verifier(bytes, rapport);

const sortie = entree.replace(/\.pdf$/i, `-anonymise-${mode}.pdf`);
writeFileSync(sortie, bytes);

console.log(`\nmode ${mode} — ${ms} ms`);
console.log(`${src.length} → ${bytes.length} octets (${(bytes.length / src.length).toFixed(2)}×)  →  ${sortie}`);
console.log(`\n${rapport.length} détection(s) :`);
for (const h of rapport) console.log(`  p.${h.page + 1}  ${h.token.padEnd(14)} ${JSON.stringify(h.value)}`);
console.log(fuites.length ? `\n❌ ${fuites.length} FUITE(S) : ${fuites.join(", ")}` : "\n✅ aucune fuite (texte extrait + octets bruts décompressés)");
process.exit(fuites.length ? 1 : 0);
