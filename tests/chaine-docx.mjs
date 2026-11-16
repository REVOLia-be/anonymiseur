/* Test de bout en bout du module de PRODUCTION js/anon-docx.js, hors navigateur.
   Détection minimale : on éprouve ici la plomberie Word (runs coupés, couches
   parallèles, métadonnées, zip), pas la qualité des règles de détection.

   Usage : node chaine-docx.mjs <fichier.docx> [pseudo|redact]

   Sur tests/fiche-word.docx (synthétique, voir fabrique-docx.mjs), des
   assertions dures s'ajoutent : aucune valeur ne subsiste nulle part, le texte
   neutre est intact octet pour octet, etc. Code de sortie 1 en cas de fuite
   ou d'assertion en échec. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { basename, resolve, dirname, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
globalThis.JSZip = require("../vendor/jszip.min.js");
await import("../js/anon-docx.js");                 // installe globalThis.AnonDocx
const JSZip = globalThis.JSZip;

const REGLES = [
  { cat: "EMAIL",    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { cat: "IBAN",     re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}\b/g },
  { cat: "NISS",     re: /\b\d{2}\.\d{2}\.\d{2}-\d{3}\.\d{2}\b/g },
  { cat: "TEL",      re: /(?:\+|00)\s?\d{1,3}(?:[ .\-/]?\d){7,11}/g },
  // le titre n'est pas masqué : « Madame » reste, seul le nom devient un jeton
  { cat: "PERSONNE", re: /(?<=(?:Madame|Monsieur|Mme|M\.)[ \t]+)[A-ZÀ-Ÿ][\wà-ÿ'-]+(?:[ \t]+[A-ZÀ-Ÿ][\wà-ÿ'-]+)*/g },
  { cat: "ORG",      re: /\b[A-ZÀ-Ÿ][\wà-ÿ]+(?:[ \t]+(?:&[ \t]+)?[A-ZÀ-Ÿ][\wà-ÿ]+)*[ \t]+(?:SRL|SA|ASBL)\b/g },
  // adresse sur deux lignes : exerce le cas « valeur à cheval sur deux paragraphes »
  { cat: "ADRESSE",  re: /Rue[ \t]+[^\n]*?\d+\n\d{4}[ \t]+[A-ZÀ-Ÿ][\wà-ÿ-]+/g },
  { cat: "MONTANT",  re: /\b\d{1,3}(?:[ .]\d{3})*(?:,\d{2})?\s?(?:€|EUR)/g },
];

const fichier = process.argv[2];
const mode = process.argv[3] || "pseudo";
if (!fichier) { console.error("usage : node chaine-docx.mjs <fichier.docx> [pseudo|redact]"); process.exit(2); }
if (!["pseudo", "redact"].includes(mode)) { console.error("mode : pseudo ou redact"); process.exit(2); }

let echecs = 0;
const verifie = (cond, msg) => { console.log(`${cond ? "  ok " : "  ÉCHEC"} ${msg}`); if (!cond) echecs++; };

/* Contrôle d'équilibrage des balises : le XML produit doit rester bien formé. */
function equilibre(xml) {
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([^\s>\/!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const pile = []; let dernier = 0, r;
  const texteOk = t => !/[<>]/.test(t) && !/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t);
  while ((r = re.exec(xml))) {
    if (!texteOk(xml.slice(dernier, r.index))) return "texte invalide près de " + r.index;
    dernier = re.lastIndex;
    if (!r[2]) continue;                                   // commentaire, CDATA, instruction
    if (r[1]) { if (pile.pop() !== r[2]) return `balise fermante inattendue </${r[2]}>`; }
    else if (!r[4]) pile.push(r[2]);
  }
  if (!texteOk(xml.slice(dernier))) return "texte invalide en fin";
  return pile.length ? `balise non fermée <${pile.pop()}>` : null;
}
const nbParagraphes = xml => (xml.match(/<w:p[ >\/]/g) || []).length;
const lire = async (zip, nom) => new TextDecoder().decode(await zip.files[nom].async("uint8array"));

const octets = new Uint8Array(readFileSync(fichier));
const avant = await AnonDocx.extraireTexte(octets);
console.log(`${avant.parties.length} partie(s) de texte, ${avant.texte.length} caractères`);
for (const p of avant.parties) console.log(`   ${p.nom.padEnd(24)} ${p.texte.length} car.`);

// détection + jetons cohérents
const hits = [];
for (const { cat, re } of REGLES) {
  re.lastIndex = 0; let m;
  while ((m = re.exec(avant.texte))) hits.push({ cat, debut: m.index, fin: m.index + m[0].length, valeur: m[0] });
}
hits.sort((a, b) => a.debut - b.debut || b.fin - a.fin);
const propres = []; let dernier = -1;
for (const h of hits) if (h.debut >= dernier) { propres.push(h); dernier = h.fin; }
const memoire = new Map(), compteur = {};
for (const h of propres) {
  const cle = h.cat + "::" + h.valeur.toLowerCase().replace(/\s+/g, " ").trim();
  if (!memoire.has(cle)) { compteur[h.cat] = (compteur[h.cat] || 0) + 1; memoire.set(cle, `[${h.cat}_${compteur[h.cat]}]`); }
  h.jeton = memoire.get(cle);
}
const remplacements = propres.map(h => ({ valeur: h.valeur, jeton: h.jeton }));
const valeurs = [...new Set(propres.map(h => h.valeur))];
console.log(`${propres.length} détection(s), ${valeurs.length} valeur(s) distincte(s)`);

const t0 = Date.now();
const rapport = await AnonDocx.anonymiser(octets, remplacements, { mode });
const ms = Date.now() - t0;
const resultat = rapport.octets;
const v = await AnonDocx.verifier(resultat, valeurs);

console.log(`${octets.length} → ${resultat.length} octets (${(resultat.length / octets.length).toFixed(2)}×) en ${ms} ms`);
console.log(`remplacements : ${rapport.nRemplacements} · liens neutralisés : ${rapport.liensNeutralises} · métadonnées vidées : ${rapport.metaNettoyees} · auteurs neutralisés : ${rapport.auteursNeutralises} · vignette retirée : ${rapport.vignetteRetiree}`);
console.log("par partie :", JSON.stringify(rapport.parPartie));
for (const a of rapport.avertissements) console.log("avertissement :", a);
console.log(`vérification : ${v.nVerifiees} valeur(s) contrôlée(s) — ${v.fuites.length ? "FUITES : " + v.fuites.join(", ") : "aucune fuite ✅"}`);
for (const d of v.details) console.log(`   fuite ${JSON.stringify(d.valeur)} → ${d.objet}`);

// Écriture : jamais dans le dépôt (les sorties de test n'y ont rien à faire).
const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..") + sep;
let sortie = resolve(fichier).replace(/\.docx$/i, `-anon-${mode}.docx`);
if (sortie.startsWith(racine)) {
  const dossier = join(tmpdir(), "anonymiseur-docx"); mkdirSync(dossier, { recursive: true });
  sortie = join(dossier, basename(sortie));
}
writeFileSync(sortie, resultat);
console.log("écrit :", sortie);
for (const h of propres) console.log(`   ${h.jeton.padEnd(14)} ${JSON.stringify(h.valeur).slice(0, 60)}`);

/* ---------------------------------------------------------- assertions */
console.log("\nContrôles génériques");
verifie(v.fuites.length === 0, "aucune fuite parmi les valeurs détectées");

const zipAvant = await JSZip.loadAsync(octets), zipApres = await JSZip.loadAsync(resultat);
const nomsAvant = Object.keys(zipAvant.files), nomsApres = Object.keys(zipApres.files);
const attendus = nomsAvant.filter(n => !/^docProps\/thumbnail\./i.test(n));
verifie(JSON.stringify(nomsApres) === JSON.stringify(attendus),
  `entrées du zip : mêmes noms, même ordre (hors vignette) — ${nomsApres.length} entrée(s), rien d'ajouté`);
verifie(nomsApres[0] === "[Content_Types].xml" || nomsAvant[0] !== "[Content_Types].xml", "[Content_Types].xml reste en tête");

for (const nom of nomsApres.filter(n => /\.(xml|rels)$/i.test(n))) {
  const err = equilibre(await lire(zipApres, nom));
  if (err) verifie(false, `XML bien formé : ${nom} — ${err}`);
}
verifie(true, `XML bien formé dans les ${nomsApres.filter(n => /\.(xml|rels)$/i.test(n)).length} partie(s) XML`);
for (const nom of nomsApres.filter(n => /^word\/.+\.xml$/i.test(n))) {
  const a = nbParagraphes(await lire(zipAvant, nom)), b = nbParagraphes(await lire(zipApres, nom));
  if (a !== b) verifie(false, `nombre de paragraphes de ${nom} : ${a} → ${b}`);
}
verifie(true, "nombre de paragraphes inchangé dans chaque partie word/");
const nbDossiers = z => Object.keys(z.files).filter(n => z.files[n].dir).length;
verifie(nbDossiers(zipApres) === nbDossiers(zipAvant), `entrées de dossier : ${nbDossiers(zipAvant)} avant, ${nbDossiers(zipApres)} après (aucune ajoutée par JSZip)`);

// le fichier se rouvre
const apres = await AnonDocx.extraireTexte(resultat);
verifie(avant.parties.length === apres.parties.length, "extraireTexte relit le résultat (mêmes parties)");
const lignes = t => t.split("\n").length;
verifie(lignes(avant.texte) === lignes(apres.texte), `même nombre de lignes de texte (${lignes(apres.texte)})`);
try {
  const mammoth = require("../vendor/mammoth.browser.min.js");
  const m = await mammoth.extractRawText({ arrayBuffer: resultat.buffer.slice(resultat.byteOffset, resultat.byteOffset + resultat.byteLength) });
  verifie(m.value.length > 0, `mammoth rouvre le fichier (${m.value.length} caractères)`);
  verifie(!valeurs.some(x => !/\s/.test(x) && m.value.includes(x)), "mammoth : aucune valeur (sans blanc) dans le texte rendu");
} catch (e) { console.log("  (mammoth non chargeable :", e.message + ")"); }

// LibreOffice, s'il est installé : preuve que le fichier est valide ET rendu sans fuite
if (process.env.SANS_LIBREOFFICE) console.log("  (LibreOffice ignoré : SANS_LIBREOFFICE)");
else {
  let soffice = null;
  for (const c of ["soffice", "libreoffice"]) { try { execFileSync(c, ["--version"], { stdio: "pipe", timeout: 30000 }); soffice = c; break; } catch (_) { /* absent */ } }
  if (!soffice) console.log("  (LibreOffice absent : conversion PDF non éprouvée)");
  else {
    const tmp = mkdtempSync(join(tmpdir(), "docx-lo-"));
    writeFileSync(join(tmp, "sortie.docx"), resultat);
    try {
      execFileSync(soffice, [`-env:UserInstallation=file://${tmp}/profil`, "--headless", "--convert-to", "pdf",
                             "--outdir", tmp, join(tmp, "sortie.docx")], { stdio: "pipe", timeout: 180000 });
      const pdf = new Uint8Array(readFileSync(join(tmp, "sortie.pdf")));
      verifie(pdf.length > 1000, `LibreOffice convertit le .docx en PDF (${pdf.length} octets)`);
      const { verifier: verifierPdf } = await import("../js/anon-pdf.js");
      const vp = verifierPdf(pdf, valeurs);
      verifie(vp.fuites.length === 0, `le PDF rendu par LibreOffice ne contient aucune valeur${vp.fuites.length ? " : " + vp.fuites.join(", ") : ""}`);
    } catch (e) { verifie(false, "LibreOffice : " + String(e.message).split("\n")[0]); }
  }
}

/* --------------------------------------------- assertions sur la fiche */
if (basename(fichier) === "fiche-word.docx") {
  const { SENSIBLES, NEUTRES } = await import("./fabrique-docx.mjs");
  console.log("\nAssertions dures sur la fiche synthétique");
  const vt = await AnonDocx.verifier(resultat, SENSIBLES);
  verifie(vt.fuites.length === 0 && vt.nVerifiees === SENSIBLES.length,
    `aucune des ${SENSIBLES.length} valeurs sensibles ne subsiste nulle part${vt.fuites.length ? " — " + vt.details.map(d => d.valeur + " → " + d.objet).join(" | ") : ""}`);
  const avantV = await AnonDocx.verifier(octets, SENSIBLES);
  verifie(avantV.fuites.length === SENSIBLES.length, `contrôle de sensibilité : l'original fuit sur les ${SENSIBLES.length} valeurs (${avantV.fuites.length})`);

  // les valeurs sont à rechercher aussi dans l'archive entière, en octets bruts
  let brut = "";
  for (const nom of nomsApres) brut += new TextDecoder("latin1").decode(await zipApres.files[nom].async("uint8array")) + "\n";
  verifie(!/Vandenberghe|Hanssen|Delvaux|Marchal|Lambert|Adminova|vandenberghe@/.test(brut), "aucun fragment de nom ou d'e-mail dans les octets décompressés");

  const doc = await lire(zipApres, "word/document.xml"), doc0 = await lire(zipAvant, "word/document.xml");
  const cr = await lire(zipApres, "word/_rels/document.xml.rels");
  const core = await lire(zipApres, "docProps/core.xml"), app = await lire(zipApres, "docProps/app.xml"), cus = await lire(zipApres, "docProps/custom.xml");
  const aucun = (re, xml) => !re.test(xml);

  // couches parallèles, une par une
  verifie(!/<w:delText[^>]*>[^<]*Marchal/.test(doc) && /<w:delText[^>]*>[^<]*<\/w:delText>/.test(doc), "texte supprimé (w:delText) : traité, élément conservé");
  if (mode === "pseudo") {
    const instr = [...doc.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)].map(x => x[1]).join("");
    verifie(instr === ' HYPERLINK "mailto:[EMAIL_1]" ', `code de champ réparti sur 2 runs : ${JSON.stringify(instr)}`);
    verifie(/w:instr=" HYPERLINK &quot;mailto:\[EMAIL_1\]&quot; "/.test(doc), "champ simple (attribut w:instr) traité et ré-encodé");
    verifie(/w:tooltip="Écrire à \[PERSONNE_\d\]"/.test(doc), "infobulle w:tooltip traitée");
    verifie(/descr="Photo de \[PERSONNE_\d\]"/.test(doc) && /title="\[PERSONNE_\d\]"/.test(doc), "texte alternatif d'image (descr, title) traité");
    verifie(/Facture de \[ORG_\d\] pour \[ORG_\d\]\./.test(doc), "valeur contenant « & » trouvée malgré l'entité &amp;");
  }
  verifie(/Target="about:blank" TargetMode="External"/.test(cr) && /Target="https:\/\/www\.exemple\.be\/accueil"/.test(cr), "lien mailto: neutralisé, lien externe neutre conservé");
  verifie(rapport.liensNeutralises === 1, "1 lien neutralisé");
  verifie(!/w:author="(?!Auteur")/.test(doc) && !/w:author="(?!Auteur")|w:initials="(?!Auteur")/.test(await lire(zipApres, "word/comments.xml")), "auteurs de révisions et de commentaires remplacés par « Auteur »");
  const people = await lire(zipApres, "word/people.xml");
  verifie(!/Vandenberghe|Hanssen|vandenberghe@/.test(people) && /w15:author="Auteur"/.test(people), "people.xml : noms et identifiants vidés");
  verifie(rapport.auteursNeutralises === 10, `auteurs neutralisés : 10 (${rapport.auteursNeutralises})`);
  verifie(/<dc:creator><\/dc:creator>/.test(core) && /<cp:lastModifiedBy><\/cp:lastModifiedBy>/.test(core) && /<dc:title><\/dc:title>/.test(core) &&
          /<dc:subject><\/dc:subject>/.test(core) && /<cp:keywords><\/cp:keywords>/.test(core) && /<dc:description><\/dc:description>/.test(core) &&
          /<cp:category><\/cp:category>/.test(core), "core.xml : 7 champs vidés, même sans valeur détectée (Claire Hanssen, Paul Delvaux)");
  verifie(/<Company><\/Company>/.test(app) && /<Manager><\/Manager>/.test(app) && /<Application>Microsoft Office Word</.test(app) && /<dcterms:created/.test(core), "app.xml : Company et Manager vidés ; reste intact");
  verifie(aucun(/Sophie/, cus) && /<vt:lpwstr><\/vt:lpwstr>/.test(cus), "custom.xml : valeur de propriété vidée");
  verifie(rapport.metaNettoyees === 10, `champs de métadonnées vidés : 10 (${rapport.metaNettoyees})`);
  verifie(rapport.vignetteRetiree && !zipApres.files["docProps/thumbnail.jpeg"] && !/thumbnail/.test(await lire(zipApres, "_rels/.rels")), "vignette : entrée ET relation retirées");
  if (mode === "pseudo") verifie(/\[PERSONNE_\d\]/.test(await lire(zipApres, "customXml/item1.xml")) && /NEUTRE-REF/.test(await lire(zipApres, "customXml/item1.xml")), "customXml : valeur remplacée, reste intact");

  // zones de texte : Choice ET Fallback
  const nbBoites = (doc.match(/Zone de texte : /g) || []).length;
  const nbJetons = (doc.match(new RegExp(mode === "pseudo" ? "Zone de texte : \\[PERSONNE_\\d\\]" : "Zone de texte : █{12}", "g")) || []).length;
  verifie(nbBoites === 2 && nbJetons === 2, "zone de texte : les 2 copies (mc:Choice et mc:Fallback) sont traitées");
  // 3 runs + signet : le texte est coupé mais la mise en forme (gras du run du milieu) subsiste
  verifie(/<w:r><w:rPr><w:b\/><\/w:rPr><w:t[^>]*><\/w:t><\/w:r>/.test(doc), "valeur coupée en 3 runs : le run central est vidé, sa mise en forme conservée");
  verifie(/<w:proofErr w:type="spellStart"\/>/.test(doc) && /<w:bookmarkStart w:id="50"/.test(doc), "proofErr et signet intacts");
  verifie(!/<w:tab\/>|<w:noBreakHyphen\/>/.test(doc), "<w:tab/> et <w:noBreakHyphen/> couverts par une valeur : supprimés");
  verifie(/<w:tab\/>|<w:tabs>/.test(doc0) && !/<w:t(?: [^>]*)?>[^<]*(Vanden|Pierre Lambert)/.test(doc), "contrôle : ces éléments existaient dans l'original");

  // texte neutre octet pour octet
  const parties = { "word/document.xml": [doc0, doc], "word/comments.xml": [await lire(zipAvant, "word/comments.xml"), await lire(zipApres, "word/comments.xml")] };
  for (const jeton of [...NEUTRES, "NEUTRE-5"]) {
    const [src, dst] = Object.values(parties).find(([s]) => s.includes(jeton));
    // NEUTRE-4 partage son paragraphe avec une image au texte alternatif sensible : on compare son run
    const [ouv, fer] = jeton === "NEUTRE-4" ? ["<w:r>", "</w:r>"] : ["<w:p>", "</w:p>"];
    const i = src.indexOf(jeton), a = src.lastIndexOf(ouv, i), b = src.indexOf(fer, i) + fer.length;
    verifie(dst.includes(src.slice(a, b)), `${fer === "</w:r>" ? "run" : "paragraphe"} « ${jeton} » intact octet pour octet`);
  }
  for (const nom of ["word/styles.xml", "word/settings.xml", "customXml/itemProps1.xml", "word/media/image1.png"]) {
    const a = await zipAvant.files[nom].async("uint8array"), b = await zipApres.files[nom].async("uint8array");
    verifie(a.length === b.length && a.every((x, k) => x === b[k]), `${nom} identique octet pour octet`);
  }
  verifie(rapport.avertissements.length === 1 && /1 image/.test(rapport.avertissements[0]), "avertissement : image non analysée");

  // limites assumées : objet incorporé et image portant une valeur → signalés, pas effacés
  const piege = await JSZip.loadAsync(octets);
  const u16 = new Uint8Array(2 * "Sophie Vandenberghe".length);
  [..."Sophie Vandenberghe"].forEach((c, k) => { u16[2 * k] = c.charCodeAt(0); });
  piege.file("word/embeddings/oleObject1.bin", u16);
  piege.file("word/media/image2.png", new TextEncoder().encode("\x89PNG....tEXt Sophie Vandenberghe...."));
  const octetsPiege = await piege.generateAsync({ type: "uint8array" });
  const rp = await AnonDocx.anonymiser(octetsPiege, remplacements, { mode });
  const vp = await AnonDocx.verifier(rp.octets, ["Sophie Vandenberghe"]);
  verifie(vp.fuites.length === 1 && vp.details[0].dansOctets && !vp.details[0].visible &&
          /objet incorporé/.test(vp.details[0].objet) && /image/.test(vp.details[0].objet),
    `objet OLE (UTF-16LE) et image : détectés par verifier — « ${vp.details[0] && vp.details[0].objet} »`);
  verifie(rp.avertissements.some(a => /2 images/.test(a)) && rp.avertissements.some(a => /1 objet incorporé/.test(a)), `avertissements : ${rp.avertissements.join(" ; ")}`);
}

console.log(echecs || v.fuites.length ? `\n❌ ${echecs} échec(s), ${v.fuites.length} fuite(s)` : "\n✅ tout est conforme");
process.exit(echecs || v.fuites.length ? 1 : 0);
