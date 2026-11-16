/* Test des RÈGLES de détection (js/regles.js), hors navigateur et sans PDF.

   1. Couverture sur un corpus synthétique belge FR/NL (103 valeurs sensibles,
      voir corpus-regles.mjs) : combien sont masquées EN ENTIER, combien à moitié
      (le pire cas : une zone colorée donne l'impression d'avoir masqué), combien
      échappent. Le code de sortie vaut 1 sous le seuil.
      La mesure se fait avec les RÉGLAGES PAR DÉFAUT de l'outil (profil
      « Général » : montants et dates ordinaires décochés) ; les dates de
      naissance, elles, doivent rester masquées.
   2. Faux positifs sur des textes SANS donnée personnelle : plafonnés, avec les
      réglages par défaut et avec tout coché.
   3. Cas unitaires : un cas par bug corrigé (B2 à B7), par règle ajoutée, par
      piège connu, puis jetons stables, ré-identification, défauts, profils
      métier et consigne pour l'IA.

   Usage : node regles.mjs          (depuis tests/, ou de n'importe où)  */
import "../js/regles.js";                         // installe globalThis.Regles
import "../js/recapitulatif.js";                  // installe globalThis.Recapitulatif
import { CORPUS, FAUX_POSITIFS, parse } from "./corpus-regles.mjs";

const R = globalThis.Regles;

/* ---- Seuils : on les relève quand les règles progressent, jamais l'inverse ---- */
const SEUILS = {
  ENTIERES: 80,              // sur 103 (la mesure d'origine était 47 ; l'objectif de départ 75)
  FR_ENTIERES: 47,           // sur 64
  NL_ENTIERES: 33,           // sur 39
  PARTIELLES: 0,             // une valeur à moitié masquée = fuite qui se croit masquée
  FAUX_POSITIFS_NEUTRES: 3,  // tout coché, sur les textes sans donnée personnelle (8 avant les corrections, sur le seul texte de l'audit)
  FAUX_POSITIFS_DEFAUT: 0,   // mêmes textes, réglages par défaut (3 avant que montants et dates ordinaires soient décochés)
  HORS_LISTE_CORPUS: 12,     // masquages hors valeurs annotées, montants et dates ordinaires exclus
  NAISSANCES: 5,             // les 5 dates de naissance du corpus, masquées avec les réglages par défaut
};

/* Réglages par défaut de l'outil : ceux du profil « Général ». */
const DEFAUT = R.reglagesProfil("general");

let echecs = 0, controles = 0;
const rouge = (s) => process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s;
function verifier(nom, ok, detail) {
  controles++;
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
console.log("== 1. Couverture sur le corpus synthétique (réglages par défaut) ==\n");
const parTag = {}, parLangue = { FR: { n: 0, ok: 0 }, NL: { n: 0, ok: 0 } };
let total = 0, entieres = 0, partielles = 0, horsListe = 0, montantsDates = 0, montantsDatesToutCoche = 0;
const manquees = [], moitie = [], parasites = [];
for (const [nom, src] of Object.entries(CORPUS)) {
  const langue = nom.startsWith("NL") ? "NL" : "FR";
  const { text, spans } = parse(src);
  const hits = analyse(text, { actives: DEFAUT });
  // tout coché : les montants et dates ordinaires redeviennent masqués
  montantsDatesToutCoche += analyse(text).filter(h => (h.cat === "MONTANT" || h.cat === "DATE") &&
    !spans.some(sp => h.start < sp.end && sp.start < h.end)).length;
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
            `\n  Montants et dates ordinaires masqués : ${montantsDates} avec les réglages par défaut, ${montantsDatesToutCoche} quand « Montant » et « Date » sont cochés`);

verifier(`couverture ${entieres}/${total} sous le seuil ${SEUILS.ENTIERES}`, entieres >= SEUILS.ENTIERES);
verifier(`FR ${parLangue.FR.ok} sous le seuil ${SEUILS.FR_ENTIERES}`, parLangue.FR.ok >= SEUILS.FR_ENTIERES);
verifier(`NL ${parLangue.NL.ok} sous le seuil ${SEUILS.NL_ENTIERES}`, parLangue.NL.ok >= SEUILS.NL_ENTIERES);
verifier(`${partielles} valeur(s) à moitié masquée(s)`, partielles <= SEUILS.PARTIELLES, moitie.join(" ; "));
verifier(`${horsListe} masquages hors valeurs annotées (plafond ${SEUILS.HORS_LISTE_CORPUS})`, horsListe <= SEUILS.HORS_LISTE_CORPUS, parasites.join(" ; "));
verifier(`dates de naissance : ${(parTag.NAISSANCE || {}).ok}/${SEUILS.NAISSANCES} masquées par défaut`, (parTag.NAISSANCE || {}).ok === SEUILS.NAISSANCES);
verifier(`${montantsDates} montant(s) ou date(s) ordinaire(s) masqué(s) avec les réglages par défaut`, montantsDates === 0);
verifier(`montants et dates ordinaires cochés : ${montantsDatesToutCoche} masqués (au moins 20 attendus)`, montantsDatesToutCoche >= 20);

/* =========================================================================
   2. Faux positifs
   ========================================================================= */
console.log("\n== 2. Faux positifs (textes sans donnée personnelle) ==\n");
let fp = 0, fpDefaut = 0;
for (const [nom, texte] of Object.entries(FAUX_POSITIFS)) {
  const hits = analyse(texte), hitsDefaut = analyse(texte, { actives: DEFAUT });
  fp += hits.length; fpDefaut += hitsDefaut.length;
  console.log(`  ${nom} : ${hitsDefaut.length} par défaut, ${hits.length} tout coché  ${fmt(hits)}`);
}
console.log(`  Total : ${fpDefaut} par défaut (plafond ${SEUILS.FAUX_POSITIFS_DEFAUT}), ${fp} tout coché (plafond ${SEUILS.FAUX_POSITIFS_NEUTRES})`);
verifier(`${fp} faux positifs sur les textes neutres, tout coché (plafond ${SEUILS.FAUX_POSITIFS_NEUTRES})`, fp <= SEUILS.FAUX_POSITIFS_NEUTRES);
verifier(`${fpDefaut} faux positifs sur les textes neutres, réglages par défaut (plafond ${SEUILS.FAUX_POSITIFS_DEFAUT})`, fpDefaut <= SEUILS.FAUX_POSITIFS_DEFAUT);

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
  verifier("B2 terme sur deux lignes", analyse("Nadia\nCollard est venue.", { termes: new Set(["Nadia Collard"]) }).length === 1);
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
  "30 juillet 1985", "1er mars 2024", "3 janv. 2024", "12.03.2024", "3/7/89", "23/05/1976"], (v) => `Fait le ${v} à Gand`);
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

// --- F : date de naissance, reconnue par son contexte (FR et NL)
{
  const NAIS = ["30 juillet 1985", "03/07/1989", "1er mars 1990", "12.03.1980", "14 februari 1990", "1989-07-03", "23/05/1976"];
  const contextes = [
    (v) => `Karim, né le ${v}, domicilié à Ixelles.`,
    (v) => `Sophie, née le ${v} à Gand.`,
    (v) => `Le travailleur, né(e) le ${v}, accepte.`,
    (v) => `Kevin, né à Gand le ${v}, preneur.`,
    (v) => `Date de naissance : ${v}`,
    (v) => `Lieu et date de naissance : Gand, ${v}`,
    (v) => `Naissance : ${v}`,
    (v) => `NÉ LE ${v}`,
    (v) => `Mevrouw Lotte Willems (°${v}) naar u.`,
    (v) => `Patiënt ° ${v}`,
    (v) => `Jan Vermeulen, geboren op ${v} te Brugge.`,
    (v) => `Jan Vermeulen, geboren te Brugge op ${v}.`,
    (v) => `Geboren: ${v}`,
    (v) => `Geboortedatum: ${v}`,
    // formulaire : libellé sur sa ligne, valeur dessous (texte extrait de fiche-reelle.pdf)
    (v) => `Adresse du domicile\n27 avenue Louise, 1050 Ixelles\nDate de naissance\n${v}\nCourriel`,
    (v) => `Naissance\n${v}`,
    (v) => `Geboortedatum\n${v}`,
    (v) => `Kevin, né à Gand le\n${v}`,
  ];
  for (const g of contextes) entiers("F date de naissance (réglages par défaut)", "DATE_NAISSANCE", NAIS.slice(0, 2), g, { actives: DEFAUT });
  entiers("F date de naissance, toutes les formes de date", "DATE_NAISSANCE", NAIS, (v) => `né le ${v}`, { actives: DEFAUT });
  // une date ordinaire n'est pas une date de naissance, et reste en clair par défaut
  const ordinaires = ["Fait à Bruxelles, le 15 janvier 2025.", "Le contrat prend effet le 1er septembre 2024.",
    "Signé le 03/04/2024.", "Facture du 05/06/2025, n° 12/03/2024.", "Une année le 3 mars 2024.",
    "Lieu de naissance : Gand. Engagé le 01/03/2025.", "Il a mené le 12/03/2024 une réunion.", "Opgemaakt te Leuven op 1 september 2025.",
    "Lieu de naissance\nGand\nEngagé le 01/03/2025.", "Date de naissance : voir annexe.\nÉchéance 05/07/2025"];
  for (const t of ordinaires) {
    const hits = analyse(t, { actives: DEFAUT });
    verifier(`F date ordinaire en clair par défaut — « ${t} »`, !hits.some(h => h.cat === "DATE" || h.cat === "DATE_NAISSANCE"), fmt(hits));
    const tout = analyse(t);
    verifier(`F date ordinaire masquée en DATE quand cochée — « ${t} »`, tout.some(h => h.cat === "DATE") && !tout.some(h => h.cat === "DATE_NAISSANCE"), fmt(tout));
  }
  // priorité : une date de naissance ne retombe JAMAIS en DATE, quel que soit l'ordre d'arrivée
  const t = "Karim, né le 03/07/1989.";
  const tout = analyse(t);
  verifier("F tout coché : la date de naissance reste DATE_NAISSANCE", fmt(tout) === "DATE_NAISSANCE:«03/07/1989»", fmt(tout));
  const det = R.detect(t, {});
  const h1 = det.find(h => h.cat === "DATE_NAISSANCE");
  const dateMeme = { ...h1, cat: "DATE", prio: 2 };
  verifier("F dédoublonnage : DATE_NAISSANCE l'emporte sur DATE (DATE en premier)", R.dedup([dateMeme, { ...h1 }]).map(h => h.cat).join() === "DATE_NAISSANCE");
  verifier("F dédoublonnage : DATE_NAISSANCE l'emporte sur DATE (DATE en second)", R.dedup([{ ...h1 }, dateMeme]).map(h => h.cat).join() === "DATE_NAISSANCE");
  verifier("F un terme ajouté à la main l'emporte toujours", R.analyser(t, { termes: new Set(["03/07/1989"]) }).actifs.map(h => h.cat).join() === "TERME");
  // la même date ailleurs dans le texte suit la date de naissance (complétion)
  const t2 = "Karim, né le 03/07/1989. Rappel : 03/07/1989.";
  const r2 = R.analyser(t2, { table: R.creerTable(), actives: DEFAUT, completer: true }).actifs;
  verifier("F complétion : la même date ailleurs est masquée comme date de naissance", r2.length === 2 && r2.every(h => h.cat === "DATE_NAISSANCE" && h.token === "[DATE_NAISSANCE_1]"), fmt(r2));
  // ré-identification du jeton composé, et de ses variantes
  const corr = { "[DATE_NAISSANCE_1]": "03/07/1989", "[DATE_1]": "01/09/2024" };
  const r = R.reidentifier("Né le [DATE_NAISSANCE_1], DATE_NAISSANCE_1, [date_naissance_1], \\[DATE\\_NAISSANCE\\_1\\], [DATE_1], [DATE_NAISSANCE_2].", corr);
  verifier("F ré-identification de [DATE_NAISSANCE_1] et de ses variantes",
    r.texte === "Né le 03/07/1989, 03/07/1989, 03/07/1989, 03/07/1989, 01/09/2024, [DATE_NAISSANCE_2]." && r.remplaces === 5 && r.inconnus.join() === "[DATE_NAISSANCE_2]", JSON.stringify(r));
}

// --- G : montants et dates ordinaires décochés par défaut, masqués quand cochés
{
  const t = "Rémunération mensuelle brute : 3 250,00 €. Le contrat prend effet le 1er septembre 2024.";
  verifier("G défaut : montant et date d'effet en clair", analyse(t, { actives: DEFAUT }).length === 0, fmt(analyse(t, { actives: DEFAUT })));
  const avecMontant = analyse(t, { actives: { ...DEFAUT, MONTANT: true } });
  verifier("G « Montant » coché : le montant est masqué", fmt(avecMontant) === "MONTANT:«3 250,00 €»", fmt(avecMontant));
  const avecDate = analyse(t, { actives: { ...DEFAUT, DATE: true } });
  verifier("G « Date » cochée : la date d'effet est masquée", fmt(avecDate) === "DATE:«1er septembre 2024»", fmt(avecDate));
  verifier("G défauts : seules MONTANT et DATE sont décochées",
    Object.entries(DEFAUT).filter(([, v]) => !v).map(([k]) => k).sort().join() === "DATE,MONTANT", JSON.stringify(DEFAUT));
}

// --- H : n° de puce électronique (ISO 11784)
{
  entiers("H puce", "PUCE", ["981000012345678", "981 000 012 345 678", "250269604123456", "056 098 100 123 456", "528140000123456", "276098106543210", "900215000123456"],
    (v) => `Chien Max, puce ${v}, vacciné.`, { actives: DEFAUT });
  entiers("H puce sans mot-clé", "PUCE", ["981000012345678", "250 269 604 123 456"], (v) => `Identifiant ${v}.`, { actives: DEFAUT });
  entiers("H puce après « réf. » mais avec « puce » devant", "PUCE", ["981000012345678"], (v) => `Puce (réf. ${v})`, { actives: DEFAUT });
  rien("H pas une puce : IBAN", "PUCE", ["IBAN BE68 5390 0754 7034", "Compte BE68539007547034", "FR76 3000 6000 0112 3456 7890 189", "NL91 ABNA 0417 1643 00"]);
  rien("H pas une puce : carte bancaire", "PUCE", ["Carte 4111 1111 1111 1111", "Carte 4111111111111111", "Amex 378282246310005", "Amex 3782 822463 10005"]);
  rien("H pas une puce : n° national et n° d'entreprise", "PUCE", ["NISS 85.07.30-033.28", "NISS 85073003328", "BCE 0456.789.123"]);
  rien("H pas une puce : long numéro de référence", "PUCE", ["Réf. produit 1234567890123456", "Commande n° 250269604123456", "Facture 981000012345678",
    "EAN 9810000123456", "Référence 123456789012345", "Total 12 345 678 901 234 567", "Lot 2502696041234567"]);
  verifier("H une carte Amex reste une carte", analyse("Amex 378282246310005").some(h => h.cat === "CARTE"));
}

// --- I : profils métier
{
  const ids = R.PROFILS.map(p => p.id).join();
  verifier("I profils attendus", ids === "general,comptabilite,rh,syndical,sante,veterinaire", ids);
  const ecarts = (id) => Object.entries(R.reglagesProfil(id)).filter(([k, v]) => v !== DEFAUT[k]).map(([k, v]) => k + "=" + v).join() || "—";
  verifier("I comptabilité : REFERENCE décochée", ecarts("comptabilite") === "REFERENCE=false", ecarts("comptabilite"));
  verifier("I RH : identique à Général", ecarts("rh") === "—", ecarts("rh"));
  verifier("I syndical : DATE cochée", ecarts("syndical") === "DATE=true", ecarts("syndical"));
  verifier("I santé : DATE cochée", ecarts("sante") === "DATE=true", ecarts("sante"));
  verifier("I vétérinaire : identique à Général, puce mise en avant", ecarts("veterinaire") === "—" && R.profil("veterinaire").enAvant.includes("PUCE"));
  for (const p of R.PROFILS) {
    const r = R.reglagesProfil(p.id);
    verifier(`I ${p.id} : puce, date de naissance, nom, n° national cochés`, r.PUCE && r.DATE_NAISSANCE && r.PERSONNE && r.NISS && r.TERME);
    verifier(`I ${p.id} : montants décochés`, r.MONTANT === false);
    verifier(`I ${p.id} : une phrase qui dit ce qu'il change`, typeof p.phrase === "string" && p.phrase.length > 20 && !!p.label);
  }
  verifier("I comptabilité : n° de facture en clair, IBAN masqué",
    fmt(analyse("Facture n° FAC-2025/0187, IBAN BE68 5390 0754 7034.", { actives: R.reglagesProfil("comptabilite") })) === "IBAN:«BE68 5390 0754 7034»");
  verifier("I santé : date de soins masquée", analyse("Consultation du 12/03/2025.", { actives: R.reglagesProfil("sante") }).some(h => h.cat === "DATE"));
  // adresse : ?metier=…
  verifier("I adresse : ?metier=comptabilite", R.profilDepuisAdresse("?metier=comptabilite") === "comptabilite");
  verifier("I adresse : ?x=1&metier=sante", R.profilDepuisAdresse("?x=1&metier=sante") === "sante");
  for (const q of ["", "?metier=nimportequoi", "?metier=", "?metier=GENERAL", "?metier=%E0", null, undefined])
    verifier(`I adresse : « ${q} » → general`, R.profilDepuisAdresse(q) === "general");
  // « personnalisé » : les cases ne correspondent plus au profil
  verifier("I memesReglages : profil intact", R.memesReglages(R.reglagesProfil("sante"), "sante") && R.memesReglages(R.reglagesProfil("rh"), "general"));
  verifier("I memesReglages : une case changée = personnalisé", !R.memesReglages({ ...R.reglagesProfil("sante"), MONTANT: true }, "sante"));
}

// --- J : consigne pour l'IA
{
  const c = R.consigneIA("pseudo", "[PERSONNE_2]");
  verifier("J consigne : texte exact, avec le jeton donné en exemple",
    c === "Ce document est pseudonymisé. Les éléments entre crochets, comme [PERSONNE_2], remplacent des données réelles : reprends-les tels quels dans ta réponse, sans les modifier ni chercher à les deviner.", c);
  verifier("J consigne : exemple par défaut", R.consigneIA("pseudo").includes("comme [PERSONNE_1],") && R.consigneIA("pseudo", "<b>").includes("[PERSONNE_1]"));
  verifier("J consigne pavés noirs : pas de jeton", !/\[/.test(R.consigneIA("redact", "[PERSONNE_1]")) && /noircis/.test(R.consigneIA("redact")));
  const corr = { "[PERSONNE_2]": "Karim El Amrani", "[EMAIL_1]": "k@exemple.be" };
  for (const [mode, ex] of [["pseudo", "[PERSONNE_2]"], ["pseudo", "[DATE_NAISSANCE_1]"], ["redact", null]]) {
    const colle = R.consigneIA(mode, ex) + "\n\nBonjour [PERSONNE_2], écrivez à [EMAIL_1].";
    const r = R.reidentifier(colle, corr);
    verifier(`J ré-identification d'un texte qui commence par la consigne (${mode} ${ex || ""})`,
      r.texte === "Bonjour Karim El Amrani, écrivez à k@exemple.be." && r.remplaces === 2 && !r.inconnus.length && r.consigneRetiree, JSON.stringify(r));
  }
  const r = R.reidentifier("Bonjour [PERSONNE_2]. Ce document est pseudonymisé.", corr);
  verifier("J sans consigne en tête : rien n'est retiré", r.texte === "Bonjour Karim El Amrani. Ce document est pseudonymisé." && !r.consigneRetiree, JSON.stringify(r));
  verifier("J consigne copiée avec des retours chariot", R.retirerConsigne(c + "\r\n\r\nSuite") === "Suite");
}

// --- K : récapitulatif d'anonymisation — aucune valeur, aucun terme, pas le nom d'origine
{
  const origine = "Contrat Karim El Amrani.pdf";
  const texte = "Entre Madame Sophie Vandenberghe et Monsieur Karim El Amrani, né le 03/07/1989, " +
    "numéro national 89.07.03-145.62, karim.elamrani@exemple.be, IBAN BE71 0961 2345 6769. Société Belgatech.";
  const termes = new Set(["Belgatech"]);
  const table = R.creerTable();
  const exclusions = new Set([R.cle({ cat: "EMAIL", value: "karim.elamrani@exemple.be" })]);
  const res = R.analyser(texte, { table, termes, exclusions, actives: DEFAUT, completer: true });
  const valeurs = res.tous.map(h => h.value);
  const libelle = (k) => (R.CATS.find(c => c.key === k) || {}).label || k;
  const infos = { date: new Date(2026, 10, 16, 9, 5), nomProduit: "Contrat [PERSONNE_2]-anonymise.pdf", entree: "pdf",
    mode: "pseudo", profil: "Général", ia: false, hits: res.actifs, libelle, nEcartees: exclusions.size, nTermes: termes.size,
    verification: { etat: "echec", nMentions: 2, nAcceptees: 1 }, avertissements: ["2 images : leur contenu n'est pas analysé"],
    interdits: [...valeurs, ...termes, origine] };
  const recap = globalThis.Recapitulatif.generer(infos);
  // un jeton peut figurer dans le NOM du fichier produit (c'est le nom réel), jamais à côté d'une valeur ailleurs
  const horsNom = recap.split("\n").filter(l => !l.startsWith("Fichier produit")).join("\n");
  const fuites = [...valeurs, ...termes, origine, "Karim", "Vandenberghe"].filter(v => recap.toLowerCase().includes(String(v).toLowerCase()))
    .concat(Object.keys(table.correspondances()).filter(t => horsNom.includes(t)));
  verifier("K récapitulatif : aucune valeur, aucun terme, aucun jeton, pas le nom d'origine", fuites.length === 0, fuites.join(" | "));
  for (const attendu of ["Récapitulatif d'anonymisation".toUpperCase(), "16/11/2026 à 09:05", "Contrat [PERSONNE_2]-anonymise.pdf",
    "Mode                : pseudonymes", "Profil métier       : Général", "non activée", "  - Nom : 2", "  - Date de naissance : 1",
    "Valeurs écartées par l'utilisateur  : 1", "Termes ajoutés à la main            : 1", "échec — 2 mentions", "acceptées malgré l'échec : 1",
    "2 images : leur contenu", "Relecture humaine effectuée : ☐ oui",
    "Outil d'aide, pas une garantie : ce récapitulatif décrit un traitement, il ne certifie pas un résultat."])
    verifier(`K récapitulatif contient « ${attendu} »`, recap.includes(attendu), recap);
  verifier("K jamais « attestation » ni « certificat »", !/attestation|certificat\b/i.test(recap));
  // filet : un nom de fichier produit qui contiendrait encore une valeur est filtré
  const r2 = globalThis.Recapitulatif.generer({ ...infos, nomProduit: "Contrat Karim El Amrani-anonymise.pdf" });
  verifier("K le nom du fichier produit est repassé au filtre", !/Karim/.test(r2) && r2.includes("Contrat [masqué]-anonymise.pdf"), r2.split("\n")[4]);
  verifier("K texte collé : vérification sans objet",
    globalThis.Recapitulatif.generer({ entree: "texte", verification: { etat: "sans-objet" } }).includes("Type d'entrée       : Texte collé"));
}

console.log(`\n${echecs ? rouge(`ÉCHEC : ${echecs} contrôle(s) en défaut`) : `OK : les ${controles} contrôles passent`}`);
process.exit(echecs ? 1 : 0);
