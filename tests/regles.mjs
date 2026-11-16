/* Test des RÈGLES de détection (js/regles.js), hors navigateur et sans PDF.

   1. Couverture sur un corpus synthétique belge FR/NL (103 valeurs sensibles,
      voir corpus-regles.mjs) : combien sont masquées EN ENTIER, combien à moitié
      (le pire cas : une zone colorée donne l'impression d'avoir masqué), combien
      échappent. Le code de sortie vaut 1 sous le seuil.
   2. Faux positifs sur des textes SANS donnée personnelle : plafonnés.
   3. Cas unitaires : un cas par bug corrigé (B2 à B7), par règle ajoutée, par
      piège connu, puis jetons stables et ré-identification.

   Usage : node regles.mjs          (depuis tests/, ou de n'importe où)  */
import "../js/regles.js";                         // installe globalThis.Regles
import { CORPUS, FAUX_POSITIFS, parse } from "./corpus-regles.mjs";

const R = globalThis.Regles;

/* ---- Seuils : on les relève quand les règles progressent, jamais l'inverse ---- */
const SEUILS = {
  ENTIERES: 80,              // sur 103 (la mesure d'origine était 47 ; l'objectif de départ 75)
  FR_ENTIERES: 47,           // sur 64
  NL_ENTIERES: 33,           // sur 39
  PARTIELLES: 0,             // une valeur à moitié masquée = fuite qui se croit masquée
  FAUX_POSITIFS_NEUTRES: 3,  // sur les textes sans donnée personnelle (8 avant les corrections, sur le seul texte de l'audit)
  HORS_LISTE_CORPUS: 12,     // masquages hors valeurs annotées, montants et dates ordinaires exclus
};

let echecs = 0;
const rouge = (s) => process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s;
function verifier(nom, ok, detail) {
  if (ok) return;
  echecs++;
  console.log(rouge(`  ✗ ${nom}`) + (detail ? `\n      ${detail}` : ""));
}
const fmt = (hits) => hits.map(h => `${h.cat}:«${h.value}»`).join(" | ") || "—";

/* Détection seule, sans table ni complétion, comme dans l'outil sur un texte collé. */
function analyse(text, o) { return R.analyser(text, Object.assign({ table: R.creerTable() }, o)).actifs; }

/* =========================================================================
   1. Corpus
   ========================================================================= */
const TITRE_EN_TETE = /^(?:(?:M\.|Mme|Mlle|Mr|Monsieur|Madame|Mademoiselle|Dr|Me|Pr|Prof|Dhr|Mevr|Mw)\.?|[Dd]e heer|[Mm]evrouw|[Mm]eneer)[ \u00a0]+/;
const sansTitre = (v) => v.replace(TITRE_EN_TETE, "");
console.log("== 1. Couverture sur le corpus synthétique ==\n");
const parTag = {}, parLangue = { FR: { n: 0, ok: 0 }, NL: { n: 0, ok: 0 } };
let total = 0, entieres = 0, partielles = 0, horsListe = 0, montantsDates = 0;
const manquees = [], moitie = [], parasites = [];
for (const [nom, src] of Object.entries(CORPUS)) {
  const langue = nom.startsWith("NL") ? "NL" : "FR";
  const { text, spans } = parse(src);
  const hits = analyse(text);
  const couvert = new Uint8Array(text.length);
  for (const h of hits) for (let k = h.start; k < h.end; k++) couvert[k] = 1;
  for (const sp of spans) {
    total++;
    let c = 0, n = 0;
    // Le titre (« Mme », « De heer ») ne fait pas partie de la valeur sensible :
    // l'outil masque le nom et laisse le titre (voir la règle PERSONNE).
    const debut = sp.tag === "NOM" ? sp.start + (TITRE_EN_TETE.exec(sp.v) || [""])[0].length : sp.start;
    for (let k = debut; k < sp.end; k++) { if (/\s/.test(text[k])) continue; n++; if (couvert[k]) c++; }
    const t = parTag[sp.tag] || (parTag[sp.tag] = { n: 0, ok: 0 });
    t.n++; parLangue[langue].n++;
    if (c === n) { entieres++; t.ok++; parLangue[langue].ok++; }
    else if (c > 0) { partielles++; moitie.push(`${nom} : « ${sp.v} » (${c}/${n} caractères)`); }
    else manquees.push(`${nom} : « ${sp.v} » [${sp.tag}]`);
  }
  for (const h of hits) {
    if (spans.some(sp => h.start < sp.end && sp.start < h.end)) continue;
    if (h.cat === "MONTANT" || h.cat === "DATE") montantsDates++;   // décision produit à part
    else { horsListe++; parasites.push(`${nom} : ${h.cat} « ${h.value} »`); }
  }
}
const pc = (a, b) => `${a}/${b} (${Math.round(100 * a / b)} %)`;
console.log(`Entièrement masquées : ${pc(entieres, total)}   |   à moitié : ${partielles}   |   non détectées : ${total - entieres - partielles}`);
console.log(`  FR : ${pc(parLangue.FR.ok, parLangue.FR.n)}   NL : ${pc(parLangue.NL.ok, parLangue.NL.n)}`);
console.log("  Par type de valeur :");
for (const [tag, t] of Object.entries(parTag)) console.log(`    ${tag.padEnd(11)} ${String(t.ok).padStart(2)}/${String(t.n).padEnd(2)} ${"█".repeat(t.ok)}${"░".repeat(t.n - t.ok)}`);
if (moitie.length) console.log("  À moitié masquées :\n    " + moitie.join("\n    "));
console.log(`  Non détectées (${manquees.length}) :\n    ` + manquees.join("\n    "));
console.log(`  Masqués hors valeurs annotées : ${horsListe}` + (parasites.length ? "\n    " + parasites.join("\n    ") : "") +
            `\n  (montants et dates ordinaires masqués, non comptés : ${montantsDates})`);

verifier(`couverture ${entieres}/${total} sous le seuil ${SEUILS.ENTIERES}`, entieres >= SEUILS.ENTIERES);
verifier(`FR ${parLangue.FR.ok} sous le seuil ${SEUILS.FR_ENTIERES}`, parLangue.FR.ok >= SEUILS.FR_ENTIERES);
verifier(`NL ${parLangue.NL.ok} sous le seuil ${SEUILS.NL_ENTIERES}`, parLangue.NL.ok >= SEUILS.NL_ENTIERES);
verifier(`${partielles} valeur(s) à moitié masquée(s)`, partielles <= SEUILS.PARTIELLES, moitie.join(" ; "));
verifier(`${horsListe} masquages hors valeurs annotées (plafond ${SEUILS.HORS_LISTE_CORPUS})`, horsListe <= SEUILS.HORS_LISTE_CORPUS, parasites.join(" ; "));

/* =========================================================================
   2. Faux positifs
   ========================================================================= */
console.log("\n== 2. Faux positifs (textes sans donnée personnelle) ==\n");
let fp = 0;
for (const [nom, texte] of Object.entries(FAUX_POSITIFS)) {
  const hits = analyse(texte);
  fp += hits.length;
  console.log(`  ${nom} : ${hits.length} masquage(s)  ${fmt(hits)}`);
}
console.log(`  Total : ${fp} (plafond ${SEUILS.FAUX_POSITIFS_NEUTRES})`);
verifier(`${fp} faux positifs sur les textes neutres (plafond ${SEUILS.FAUX_POSITIFS_NEUTRES})`, fp <= SEUILS.FAUX_POSITIFS_NEUTRES);

/* =========================================================================
   3. Cas unitaires
   ========================================================================= */
console.log("\n== 3. Cas unitaires ==\n");

/* `entiers` : chaque valeur doit ressortir telle quelle, avec la catégorie voulue. */
function entiers(titre, cat, valeurs, gabarit = (v) => `Voir : ${v}, merci.`, o) {
  for (const v of valeurs) {
    const hits = analyse(gabarit(v), o);
    verifier(`${titre} — « ${v} »`, hits.some(h => h.cat === cat && h.value === v), `obtenu : ${fmt(hits)}`);
  }
}
/* `rien` : aucune détection de cette catégorie (ou aucune du tout si cat vaut null). */
function rien(titre, cat, textes) {
  for (const t of textes) {
    const hits = analyse(t).filter(h => !cat || h.cat === cat);
    verifier(`${titre} — « ${t} »`, hits.length === 0, `obtenu : ${fmt(hits)}`);
  }
}

// --- B2 : un terme ajouté n'est jamais reconnu à l'intérieur d'un mot
{
  const t = "Anne Lemaire a signé l'annexe le 3e jour de l'année. Marc a visité le marché. Paul et Pauline.";
  const hits = analyse(t, { termes: new Set(["Anne", "Marc", "Paul"]) });
  verifier("B2 termes : seuls les mots entiers", fmt(hits) === "TERME:«Anne» | TERME:«Marc» | TERME:«Paul»", fmt(hits));
  const { actifs } = R.analyser(t, { table: R.creerTable(), termes: new Set(["Anne"]) });
  verifier("B2 « Anne » ne touche ni « annexe » ni « année »", actifs.length === 1 && actifs[0].start === 0);
  const web = "Voir REVOLia.be ou écrire à contact@REVOLia.be (REVOLia, revolia).";
  verifier("B2 « REVOLia » reste reconnu dans « REVOLia.be » et sans la casse",
    analyse(web, { termes: new Set(["REVOLia"]) }).filter(h => h.cat === "TERME").length === 3);
  verifier("B2 … et dans une adresse e-mail quand la catégorie E-mail est décochée",
    analyse(web, { termes: new Set(["REVOLia"]), actives: { EMAIL: false } }).filter(h => h.cat === "TERME").length === 4);
  // terme à plusieurs mots, coupé par un saut de ligne (PDF)
  verifier("B2 terme sur deux lignes", analyse("Claire\nHanssen est venue.", { termes: new Set(["Claire Hanssen"]) }).length === 1);
  verifier("B2 terme introuvable : zéro occurrence", R.occurrencesTerme("Une annexe.", "Anne") === 0 && R.occurrencesTerme("Anne vient.", "anne") === 1);
  // complétion des occurrences (valeur trouvée par l'IA à un endroit, pas aux autres)
  const txt = "Marc signe. Le marché, Marché aux fleurs. Marc revient.";
  const ner = [{ cat: "PERSONNE", start: 0, end: 4, value: "Marc", prio: 1 }];
  const complet = R.analyser(txt, { table: R.creerTable(), ner, completer: true }).actifs;
  verifier("B2 complétion : « Marc » ni dans « marché » ni dans « Marché »", complet.length === 2 && complet.every(h => h.value === "Marc"), fmt(complet));
}

// --- B3 : prénoms composés, particules, titres néerlandais
for (const v of ["M. Jean-Luc Dehaene", "Mme Van den Broeck", "Monsieur DUPONT", "Madame VAN DEN BERGHE",
  "De heer Pieter De Smet", "mevrouw Lotte Willems", "Mevrouw Annelies Van den Bossche", "Dr Pieter Janssens",
  "Mme Aïcha Benali", "Me De Clercq", "Dr. Wim Van Damme", "Madame Sophie Vandenberghe", "Monsieur Karim El Amrani"]) {
  // le nom est masqué EN ENTIER, le titre reste (il n'identifie personne)
  const hits = analyse(`Bonjour ${v}, merci de votre retour.`);
  verifier(`B3 nom entier, sans son titre — « ${v} »`, hits.some(h => h.cat === "PERSONNE" && h.value === sansTitre(v)), `obtenu : ${fmt(hits)}`);
}
{
  // le même nom écrit SANS titre ailleurs est masqué aussi (constaté sur un contrat Word)
  const t = "Entre Madame Sophie Vandenberghe et la société. Note : voir la fiche de Sophie Vandenberghe.";
  const r = R.analyser(t, { table: R.creerTable(), completer: true }).actifs.filter(h => h.cat === "PERSONNE");
  verifier("B3 le nom sans titre est masqué partout", r.length === 2 && r.every(h => h.value === "Sophie Vandenberghe" && h.token === r[0].token), fmt(r));
}
rien("B3 pas un nom", "PERSONNE", ["Madame la Présidente a parlé.", "Monsieur le Directeur a répondu.", "Merci, Madame, Monsieur."]);

// --- B4 : communes composées, faux codes postaux
entiers("B4 commune entière", "CP_VILLE", ["1200 Woluwe-Saint-Lambert", "1348 Louvain-la-Neuve", "1420 Braine-l'Alleud",
  "1000 BRUXELLES", "B-4000 Liège", "8200 Sint-Andries", "1080 Molenbeek-Saint-Jean", "1180 Uccle", "9000 Sint Niklaas"],
  (v) => `Domicile : ${v}.`);
rien("B4 pas un code postal", "CP_VILLE", ["article 1382 Code civil", "Exercice 2023 Rapport annuel", "Lot 2025 Wallonie",
  "En 2024 Bruxelles Environnement a publié", "Budget 2024 Bilan"]);
verifier("B4 la ville ne déborde pas sur ce qui suit",
  fmt(analyse("Fait à 1000 Bruxelles le 15 janvier. 4000 Liège, le 4 novembre.")) === "CP_VILLE:«1000 Bruxelles» | CP_VILLE:«4000 Liège»");

// --- B5 : téléphones étrangers, jamais des dates
entiers("B5 téléphone étranger", "TEL", ["+33 6 12 34 56 78", "+31 6 1234 5678", "+352 621 123 456", "+49 30 12345678",
  "+44 20 7946 0958", "+32 (0)2 512 34 56", "0032 2 512 34 56", "+32 478 12 34 56"], (v) => `Tél : ${v}.`);
verifier("B5 aucune date dans un numéro étranger",
  !analyse("Appelez +33 6 12 34 56 78 ou +31 6 1234 5678 ou +352 621 123 456.").some(h => h.cat === "DATE"));
rien("B5 pas une date (espaces)", "DATE", ["Réf. 03 07 1989 interne"]);
entiers("TEL belge, inchangé", "TEL", ["071/12.34.56", "02 512 34 56", "010 45 67 89", "0476.12.34.56", "04/222.33.44", "0495/12.34.56"], (v) => `Tél : ${v}.`);

// --- B6 : IBAN étrangers entiers, validés par le modulo 97
entiers("B6 IBAN entier", "IBAN", ["FR76 3000 6000 0112 3456 7890 189", "NL91ABNA0417164300", "NL91 ABNA 0417 1643 00",
  "DE89 3704 0044 0532 0130 00", "LU28 0019 4006 4475 0000", "GB29 NWBK 6016 1331 9268 19", "BE68 5390 0754 7034", "BE68539007547034"],
  (v) => `IBAN : ${v} merci`);
verifier("B6 un mot en capitales après l'IBAN n'est pas avalé",
  fmt(analyse("BE68 5390 0754 7034 ET voilà.")) === "IBAN:«BE68 5390 0754 7034»", fmt(analyse("BE68 5390 0754 7034 ET voilà.")));
rien("B6 pas un IBAN (clé fausse, aucun contexte)", "IBAN", ["Code produit AB12 CDEF GHIJ", "Réf FR76 3000 6000 0112 3456 7890 180 stock"]);
verifier("B6 clé fausse mais « compte » devant : masqué quand même (coquille)",
  analyse("Virement sur le compte BE43 0682 4417 9301.").some(h => h.cat === "IBAN" && h.value === "BE43 0682 4417 9301"));

// --- B7 : montants
entiers("B7 montant", "MONTANT", ["300 euros", "875,00 euro", "€ 1.250,00", "EUR 300", "3000 EUR", "2 845,30 €", "950,00 EUR", "1.250 €"],
  (v) => `Prix : ${v} par mois.`);
{
  const { actifs } = R.analyser("Loyer de 300 euros par mois.", { table: R.creerTable() });
  const anon = "Loyer de 300 euros par mois.".replace(actifs[0].value, actifs[0].token);
  verifier("B7 pas de « os » résiduel", anon === "Loyer de [MONTANT_1] par mois.", anon);
}

// --- C : mois néerlandais, dates ISO
entiers("DATE", "DATE", ["14 februari 1990", "3 oktober 1988", "1 september 2025", "3 juli 1989", "2 mei 2020", "1989-07-03",
  "30 juillet 1985", "1er mars 2024", "3 janv. 2024", "12.03.2024", "3/7/89", "23/05/1976"], (v) => `né le ${v} à Gand`);
rien("DATE : ISO impossible, mois sans année", "DATE", ["code 1989-13-45", "le 12 octobre", "le 15 janvier. 4000 pièces"]);

// --- C : clés de contrôle et repli sur le contexte
entiers("NISS clé juste (avant 2000)", "NISS", ["85.07.30-033.28", "85073003328"], (v) => `n° ${v}`);
entiers("NISS clé juste (après 2000)", "NISS", ["01.02.03-001.70", "01020300170"], (v) => `n° ${v}`);
entiers("NISS clé fausse + contexte", "NISS", ["85.07.30-033.99"], (v) => `NISS : ${v}`);
entiers("NISS clé fausse + contexte NL", "NISS", ["90.02.14-123.99"], (v) => `Rijksregisternummer: ${v}`);
rien("NISS clé fausse sans contexte", "NISS", ["Référence produit 12345678901.", "n° 85.07.30-033.99"]);
entiers("BCE clé juste", "TVA_BE", ["0123.456.749", "1023.456.797", "0456789133", "BE 1023.456.797"], (v) => `Société ${v}`);
entiers("BCE clé fausse + préfixe BE", "TVA_BE", ["BE 1002.345.678", "BE0412.345.678"], (v) => `Société ${v}`);
entiers("BCE clé fausse + contexte", "TVA_BE", ["0456.789.123", "1002.345.678"], (v) => `Ondernemingsnummer: ${v}`);
rien("BCE clé fausse sans contexte", "TVA_BE", ["Total 1234.567.890 pièces", "Lot 0123456780"]);

// --- C : nouvelles catégories
entiers("RUE (FR)", "RUE", ["Chaussée de Waterloo 412", "Rue des Alliés 27 bte 3", "Avenue Brugmann 156", "Place du Jeu de Balle 8",
  "Boulevard de la Sauvenière 33", "14 rue de la Loi", "27 avenue Louise", "Rue de Namur 14"], (v) => `Domicilié ${v}, à Bruxelles.`);
entiers("RUE (NL)", "RUE", ["Kerkstraat 52", "Stationsstraat 45", "Lange Kievitstraat 112 bus 4", "Dorpsstraat 7", "Grote Markt 3",
  "Zandstraat 19", "Sint-Jansstraat 4", "Koning Albertlaan 12a"], (v) => `Woont ${v}, 3000 Leuven.`);
verifier("RUE : le code postal qui suit n'est pas avalé",
  fmt(analyse("Avenue Louise, 1050 Ixelles")) === "RUE:«Avenue Louise» | CP_VILLE:«1050 Ixelles»", fmt(analyse("Avenue Louise, 1050 Ixelles")));
rien("RUE : pas une rue", "RUE", ["Il habite dans la rue, près de la place du marché.", "La route est longue.", "Kerkstraat"]);
entiers("PLAQUE", "PLAQUE", ["1-ABC-234", "2-DEF-567"], (v) => `Plaque ${v} garée.`);
rien("PLAQUE : pas une plaque", "PLAQUE", ["Réf. 12-ABC-2345"]);
entiers("INAMI / RIZIV", "INAMI", ["1-23456-78-901", "1-98765-43-210"], (v) => `N° ${v}.`);
entiers("INAMI compact après le mot-clé", "INAMI", ["12345678901"], (v) => `INAMI : ${v}.`);
entiers("RIZIV compact après le mot-clé", "INAMI", ["12345678901"], (v) => `RIZIV-nummer ${v}.`);
rien("INAMI compact sans mot-clé", "INAMI", ["Référence produit 12345678901."]);
entiers("Carte d'identité", "CARTE_ID", ["591-2345678-90"], (v) => `carte n° ${v}.`);
entiers("Référence de dossier", "REFERENCE", ["EMP-00427", "RH/2025/0342", "2025/ABV/118", "2025-0187"],
  (v) => `dossier : ${v} ouvert`);
entiers("Référence après « réf. » et « matricule »", "REFERENCE", ["RH/2025/0342", "EMP-00427"], (v) => `Objet — réf. ${v}.`);
rien("Référence : pas un mot ordinaire", "REFERENCE", ["Le dossier en-cours sera traité.", "dossier mi-temps", "n° 4500123456"]);
entiers("E-mail écrit « (at) »", "EMAIL", ["thomas.mathieu (at) exemple.org", "x [at] exemple.org", "jean(arobase)truc.be"],
  (v) => `Écrivez à ${v} svp.`);

// --- E : exclusions
{
  const mots = ["SRL", "S.R.L.", "sprl", "asbl", "BV", "NV", "vzw", "bvba", "SA"];
  const ner = mots.map((m, i) => ({ cat: "ORG", start: i * 10, end: i * 10 + m.length, value: m, prio: 1 }));
  const texte = mots.map(m => m.padEnd(10)).join("");
  verifier("EXCLUDE : formes juridiques belges FR/NL jamais masquées seules", R.analyser(texte, { ner }).actifs.length === 0);
  verifier("EXCLUDE : mais un terme désigné à la main est toujours masqué", R.analyser("La Directrice SRL.", { termes: new Set(["Directrice"]) }).actifs.length === 1);
}

// --- D : jetons stables
{
  const texte = "Madame Sophie Vandenberghe écrit à Monsieur Karim El Amrani et à Monsieur Luc Janssens. Madame Sophie Vandenberghe signe.";
  const table = R.creerTable();
  const a = R.analyser(texte, { table });
  const jeton = (res, v) => (res.actifs.find(h => h.value === v) || {}).token;
  verifier("D jetons attribués dans l'ordre", jeton(a, "Sophie Vandenberghe") === "[PERSONNE_1]" && jeton(a, "Karim El Amrani") === "[PERSONNE_2]" && jeton(a, "Luc Janssens") === "[PERSONNE_3]", fmt(a.actifs));
  const sophie = new Set([R.cle({ cat: "PERSONNE", value: "Sophie Vandenberghe" })]);
  const b = R.analyser(texte, { table, exclusions: sophie });
  verifier("D écarter une détection ne renumérote pas les autres",
    jeton(b, "Karim El Amrani") === "[PERSONNE_2]" && jeton(b, "Luc Janssens") === "[PERSONNE_3]" && !jeton(b, "Sophie Vandenberghe"));
  const c = R.analyser(texte, { table });
  verifier("D la remettre lui rend son ancien jeton", jeton(c, "Sophie Vandenberghe") === "[PERSONNE_1]");
  const corr = table.correspondances();
  verifier("D la table garde le jeton écarté (une réponse d'IA déjà obtenue doit rester lisible)", corr["[PERSONNE_1]"] === "Sophie Vandenberghe", JSON.stringify(corr));
  // un nouveau venu ne reprend pas un numéro libéré : les compteurs n'avancent que
  const t2 = R.creerTable();
  R.analyser("Madame Anne Dupont et Monsieur Paul Martin.", { table: t2 });
  R.analyser("Madame Anne Dupont et Monsieur Paul Martin et Monsieur Eric Lambert.", { table: t2, exclusions: new Set([R.cle({ cat: "PERSONNE", value: "Anne Dupont" })]) });
  verifier("D un nouveau venu reçoit un numéro neuf", t2.correspondances()["[PERSONNE_3]"] === "Eric Lambert", JSON.stringify(t2.correspondances()));
  // casse et espaces ne créent pas deux jetons
  const t3 = R.creerTable();
  const r3 = R.analyser("Monsieur DUPONT, puis Monsieur  Dupont.", { table: t3 });
  verifier("D même valeur (casse, espaces) = même jeton", new Set(r3.actifs.map(h => h.token)).size === 1, fmt(r3.actifs));
  table.vider();
  verifier("D vider la table remet les compteurs à zéro", R.analyser(texte, { table }).actifs[0].token === "[PERSONNE_1]" && table.taille === 3);
}

// --- E : ré-identification
{
  const corr = { "[PERSONNE_1]": "Sophie Vandenberghe", "[PERSONNE_2]": "Karim El Amrani", "[EMAIL_1]": "k@exemple.be", "[TEL_1]": "0478 12 34 56" };
  const r = R.reidentifier("Bonjour [PERSONNE_1], [PERSONNE_1] et [PERSONNE_9] ; écrivez à [EMAIL_1].", corr);
  verifier("E remplacements exacts", r.texte === "Bonjour Sophie Vandenberghe, Sophie Vandenberghe et [PERSONNE_9] ; écrivez à k@exemple.be." && r.remplaces === 3 && r.variantes === 0, JSON.stringify(r));
  verifier("E jeton inconnu signalé", r.inconnus.join() === "[PERSONNE_9]", JSON.stringify(r.inconnus));
  verifier("E jetons de la table absents de la réponse", r.absents.join() === "[PERSONNE_2],[TEL_1]", JSON.stringify(r.absents));
  const v = R.reidentifier("PERSONNE_1 puis [ personne_2 ] puis [Personne_1] puis \\[EMAIL\\_1\\] puis PERSONNE_12", corr);
  verifier("E variantes (sans crochets, espaces, casse, markdown) pour les jetons de la table",
    v.texte === "Sophie Vandenberghe puis Karim El Amrani puis Sophie Vandenberghe puis k@exemple.be puis PERSONNE_12" && v.remplaces === 4 && v.variantes === 4, JSON.stringify(v));
  verifier("E « PERSONNE_12 » n'est pas pris pour « PERSONNE_1 » suivi d'un 2", v.inconnus.join() === "[PERSONNE_12]", JSON.stringify(v.inconnus));
  const w = R.reidentifier("Le rapport_1 de user_2 et [Note_3] restent tels quels.", corr);
  verifier("E ni identifiant ordinaire ni crochet banal pris pour un jeton", w.texte === "Le rapport_1 de user_2 et [Note_3] restent tels quels." && w.inconnus.length === 0, JSON.stringify(w));
  verifier("E variante inconnue d'une catégorie connue signalée", R.reidentifier("voir [tel_7]", corr).inconnus.join() === "[TEL_7]");
}

// --- E : suggestions de noms (jamais masquées d'office)
{
  const sug = (t, hits = [], termes = []) => R.suggestionsDeNoms(t, hits, termes).map(x => x.v);
  verifier("suggestions : « Bonjour Thomas Mathieu » sans la formule", sug("Bonjour Thomas Mathieu, merci.").join() === "Thomas Mathieu", sug("Bonjour Thomas Mathieu, merci."));
  verifier("suggestions : particules entières", sug("Contact : Kevin Van den Broeck, locataire.").join() === "Kevin Van den Broeck", sug("Contact : Kevin Van den Broeck, locataire."));
  verifier("suggestions : « Cher Confrère » ou « Beste Pieter » ne sont plus proposés", sug("Cher Confrère,\nBeste Pieter,\nTussen Mevrouw Annelies\nEntre Madame Dupont").length === 0, sug("Cher Confrère,\nBeste Pieter,\nTussen Mevrouw Annelies\nEntre Madame Dupont"));
  verifier("suggestions : « Geachte Hilde Maes » → « Hilde Maes »", sug("Geachte Hilde Maes, ").join() === "Hilde Maes");
  verifier("suggestions : déjà masqué ou déjà ajouté = pas proposé", sug("Marc Wauters et Sandrine Claes", [{ value: "Marc Wauters" }], ["Sandrine Claes"]).length === 0);
}

console.log(`\n${echecs ? rouge(`ÉCHEC : ${echecs} contrôle(s) en défaut`) : "OK : tous les contrôles passent"}`);
process.exit(echecs ? 1 : 0);
