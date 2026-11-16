/* ===========================================================================
   Règles de détection — la partie PURE de l'anonymiseur (aucun accès au DOM).

   Sortie du gros <script> d'index.html pour deux raisons : pouvoir les tester
   sous Node (tests/regles.mjs mesure la couverture sur un corpus belge FR/NL),
   et ne plus avoir deux copies d'une même règle. Script classique, comme
   anon-geom.js : il installe `globalThis.Regles`.

   Contenu : catégories (expressions + validateurs), exclusions, détection,
   dédoublonnage, complétion des occurrences, table de jetons de SESSION,
   suggestions de noms, ré-identification.

   Deux conventions à connaître avant de toucher à une expression :
   · drapeau `u` + `\p{L}` : `\b` ne voit que l'ASCII, il coupe donc « Liège »
     ou « Genappé » au mauvais endroit. Les limites de mot sont écrites
     `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`.
   · sous `iu`, `\p{Lu}` reconnaît AUSSI les minuscules. Une règle qui compte
     sur la majuscule (noms, rues, communes) s'écrit sans `i`.
   =========================================================================== */
(function (global) {
  "use strict";

  const G = "(?<![\\p{L}\\p{N}])";          // pas de lettre ni de chiffre avant
  const D = "(?![\\p{L}\\p{N}])";           // … ni après
  const L = "\\p{Lu}", l = "\\p{Ll}";

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* Clé d'une valeur : même catégorie + même texte (casse et espaces ignorés)
     = même entité. C'est aussi la clé des exclusions faites à la main. */
  function cle(h) {
    return h.cat + "::" + String(h.value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  /* Un mot de contexte se trouve-t-il juste avant la position ? */
  function contexte(text, index, re, portee) {
    return re.test(text.slice(Math.max(0, index - (portee || 40)), index));
  }

  /* ----------------------------- validateurs -----------------------------
     Un validateur reçoit (valeur, texte, position) et renvoie false (rejet),
     true (accepté), ou un ENTIER : la longueur à conserver (le motif en a pris
     trop, cas d'un IBAN suivi d'un mot en capitales). */

  function luhn(v) {                              // vraie carte bancaire
    const d = v.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) return false;
    let s = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt;
    }
    return s % 10 === 0;
  }

  /* Téléphone : belge (fixe 9 chiffres, mobile 04xx 10 chiffres) ou étranger
     d'un indicatif courant (8 à 11 chiffres après l'indicatif). */
  const INDICATIFS = ["352", "212", "216", "213", "33", "31", "49", "44", "39", "34", "41", "90", "32"];
  function validTel(v) {
    const s = v.replace(/\(0\)/g, "").trim();      // « +32 (0)2 … » : le 0 est facultatif
    if (/\.\d{3}/.test(s)) return false;           // « .744 » = séparateur de milliers, pas un n°
    let d = s.replace(/\D/g, "");
    if (/^(?:\+|00)/.test(s)) {
      if (s.startsWith("00")) d = d.slice(2);
      const cc = INDICATIFS.find(c => d.startsWith(c));
      if (!cc) return false;
      let reste = d.slice(cc.length);
      if (cc === "32") {
        d = "0" + reste.replace(/^0/, "");
        return d.length === 10 ? d[1] === "4" : d.length === 9;
      }
      return reste.length >= 8 && reste.length <= 11;
    }
    if (d[0] !== "0") return false;
    if (d.length === 10) return d[1] === "4";      // mobile BE : 04xx xx xx xx
    return d.length === 9;                          // fixe BE : 0x xxx xx xx
  }

  /* N° national : clé = 97 − (9 premiers chiffres mod 97), ou la même avec un
     « 2 » devant pour les naissances depuis 2000. Clé fausse (coquille) : on
     masque quand même si un mot de contexte précède — une coquille dans un vrai
     numéro ne doit pas le laisser passer. */
  function validNiss(v, text, i) {
    const d = v.replace(/\D/g, "");
    if (d.length !== 11) return false;
    const n = +d.slice(0, 9), c = +d.slice(9);
    if (97 - (n % 97) === c || 97 - ((2000000000 + n) % 97) === c) return true;
    return contexte(text, i, /NISS|national|rijksregister|INSZ|registre|RRN/i);
  }

  /* N° d'entreprise (BCE) : commence par 0 ou 1 ; clé = 97 − (8 premiers mod 97).
     Préfixe « BE » explicite, clé juste ou mot de contexte : l'un des trois. */
  function validBce(v, text, i) {
    const d = v.replace(/\D/g, "");
    if (d.length !== 10) return false;
    if (97 - (+d.slice(0, 8) % 97) === +d.slice(8)) return true;
    if (/^BE/i.test(v.trim())) return true;
    return contexte(text, i, /BCE|KBO|TVA|BTW|VAT|ondernemings|entreprise/i);
  }

  /* IBAN : ISO 13616 — on déplace les 4 premiers caractères à la fin, on
     remplace les lettres par 10…35, le reste modulo 97 doit valoir 1. */
  const LONGUEURS_IBAN = { BE: 16, FR: 27, NL: 18, DE: 22, LU: 20, GB: 22, ES: 24, IT: 27, CH: 21,
    AT: 20, PT: 25, IE: 22, DK: 18, SE: 24, NO: 15, PL: 28, FI: 18, GR: 27, CZ: 24, HU: 28 };
  function mod97(s) {
    const r = s.slice(4) + s.slice(0, 4);
    let reste = 0;
    for (const ch of r) {
      const v = ch >= "A" ? ch.charCodeAt(0) - 55 : +ch;
      reste = (v > 9 ? reste * 100 + v : reste * 10 + v) % 97;
    }
    return reste === 1;
  }
  function validIban(v, text, i) {
    const pos = [];
    for (let k = 0; k < v.length; k++) if (/[A-Z0-9]/.test(v[k])) pos.push(k);
    const compact = pos.map(k => v[k]).join("");
    const L0 = LONGUEURS_IBAN[compact.slice(0, 2)];
    const ctx = () => contexte(text, i, /IBAN|compte|rekening|BIC|virement|overschrijving|bank/i);
    // longueurs à essayer : celle du pays, sinon toutes, de la plus longue à 15
    const essais = [];
    if (L0) { if (compact.length >= L0) essais.push(L0); }
    else for (let n = compact.length; n >= 15; n--) essais.push(n);
    const fin = (n) => {                            // longueur de texte à garder
      const f = pos[n - 1] + 1;
      if (f >= v.length) return true;
      return /[A-Za-z0-9]/.test(v[f]) ? false : f;  // on ne coupe pas au milieu d'un mot
    };
    for (const n of essais) if (mod97(compact.slice(0, n))) return fin(n);
    if (!ctx()) return false;                       // clé fausse : seulement avec un mot de contexte
    return L0 && compact.length >= L0 ? fin(L0) : true;
  }

  /* Code postal + commune : on écarte ce qui n'en est pas (« 1382 Code »,
     « 2023 Rapport », « 2025 Wallonie », « 2024 Bruxelles Environnement »).
     Pas de liste des codes postaux : un code de 1900 à 2099 est aussi un code
     d'Anvers. Seules les évidences sont rejetées. */
  const PAS_UNE_COMMUNE = new Set(("code rapport bilan budget exercice article annexe page chapitre section " +
    "total montant version tableau figure loi décret arrêté directive règlement norme décision note plan " +
    "année annee wallonie flandre belgique europe région region union vlaanderen wallonië belgië nederland " +
    "janvier février fevrier mars avril mai juin juillet août aout septembre octobre novembre décembre decembre " +
    "januari februari maart april mei juni juli augustus september oktober november december").split(" "));
  function validCp(v) {
    const m = v.match(/^(?:[A-Z]-)?(\d{4,5})[ ]+(.+)$/su);
    if (!m) return false;
    const mots = m[2].split(/[ \-'’]/);
    // « Le Roeulx », « Sint Niklaas » : le mot qui compte est le premier mot propre
    const premier = mots[0].toLowerCase();
    if (PAS_UNE_COMMUNE.has(premier)) return false;
    if (/^(bruxelles|brussel|brussels)$/i.test(premier) && m[1].length === 4 && (+m[1] < 1000 || +m[1] > 1299)) return false;
    return true;
  }

  /* Référence de dossier : il faut un chiffre et pas de minuscule (« dossier
     en-cours » ressemblait à une référence sous le drapeau i). */
  function validReference(v) { return /^[A-Z0-9\/\-]+$/.test(v) && /\d/.test(v); }

  /* ------------------------------ catégories ------------------------------
     Ordre = priorité à égalité de position et de longueur (les plus
     spécifiques d'abord). Les catégories alimentées par l'IA ou par
     l'utilisateur n'ont pas d'expression. */

  const MOIS = "janv(?:ier)?|f[ée]vr(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?" +
               "|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december";

  // année : 4 chiffres plausibles (19xx, 20xx) ou 2 chiffres — « janvier. 4000 » n'est pas une date
  const AN = "(?:(?:19|20)\\d{2}|\\d{2})";

  // Nom de personne : prénoms composés, particules, NOM en capitales.
  // « le » / « la » ne sont PAS des particules : « Madame la Présidente » n'est pas un nom.
  const NOM_MOT = `(?:${L}${l}+(?:(?:['’-])?${L}${l}+|['’]${l}+)*|${L}{2,}(?:-${L}{2,})*)`;
  const PARTICULE = `(?:[Vv]an(?:[ ][Dd]e[nr]?)?|[Dd]e|[Dd]en|[Dd]er|[Dd]u|[Vv]on|[Dd]['’]|[Ee]l)`;
  const TITRE = `(?:(?:M\\.|Mme|Mlle|Mr|Monsieur|Madame|Mademoiselle|Dr|Me|Pr|Prof|Dhr|Mevr|Mw)\\.?|[Dd]e heer|[Mm]evrouw|[Mm]eneer)`;
  const SP = "[ \\u00a0]";

  const VOIES_FR = "[Rr]ue|[Aa]venue|[Aa]v\\.|[Bb]oulevard|[Bb]d|[Cc]haussée|[Pp]lace|[Cc]hemin|[Qq]uai|[Ii]mpasse|[Aa]llée|[Rr]oute|[Dd]rève|[Cc]los|[Ss]quare|[Ss]entier|[Rr]empart|[Pp]arvis|[Rr]ésidence";
  const PARTICULES_RUE = "(?:du|de la|de l['’]|des|de|d['’]|l['’]|aux?)";
  const NUM_RUE = "\\d{1,3}(?!\\d)[A-Za-z]?(?:[ ]*(?:bte|boîte|bus|b)\\.?[ ]*\\d+)?";
  const SUFFIXES_NL = "straat|laan|steenweg|plein|lei|dreef|weg|baan|kaai|markt|dijk|singel|vest|hof|pad|gracht";

  const MOT_VILLE = `(?:${L}${l}+|${L}{2,})`;
  const PARTIE_VILLE = "(?:la|le|les|lez|sur|sous|aan|op|de|den|l|d|en|ter|ten|van)";

  const CATS = [
    { key: "EMAIL", label: "E-mail", color: "#5b8def",
      re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
      // écrit à la main pour tromper les robots : « x (at) exemple.org »
      aussi: [/[\w.+-]+[ ]*[\[(][ ]*(?:at|arobase)[ ]*[\])][ ]*[\w-]+(?:[ ]*(?:\.|[\[(][ ]*(?:dot|point)[ ]*[\])])[ ]*[\w-]+)+/gi] },
    { key: "IBAN", label: "IBAN", color: "#0b9d63",
      re: new RegExp(`${G}[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?${D}`, "gu"), valid: validIban },
    { key: "NISS", label: "N° national", color: "#e5484d",
      re: /\b\d{2}[.\-]?\d{2}[.\-]?\d{2}[.\- ]?\d{3}[.\-]?\d{2}\b/g, valid: validNiss },
    { key: "TVA_BE", label: "N° entreprise (BE)", color: "#f2c14e",
      re: new RegExp(`(?<![\\p{L}\\p{N}.,])(?:BE[ ]?)?[01]\\d{3}[. ]?\\d{3}[. ]?\\d{3}(?![\\p{N}]|[.,]\\d)`, "giu"), valid: validBce },
    { key: "INAMI", label: "N° INAMI / RIZIV", color: "#9acd32",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])[1-9]-\\d{5}-\\d{2}-\\d{3}(?![\\p{N}-])|(?<=(?:INAMI|RIZIV)[^\\n\\d]{0,20})(?<!\\d)\\d{11}(?!\\d)`, "giu") },
    { key: "PLAQUE", label: "Plaque d’immatriculation", color: "#e07a3f",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])[1-9]-[A-Z]{3}-\\d{3}(?![\\p{L}\\p{N}-])`, "gu") },
    { key: "CARTE_ID", label: "Carte d’identité", color: "#e879f9",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])\\d{3}-\\d{7}-\\d{2}(?![\\p{N}-])`, "gu") },
    { key: "CARTE", label: "Carte bancaire", color: "#e5484d",
      re: /\b\d{4}[ \-]\d{4}[ \-]\d{4}[ \-]\d{2,7}\b|\b\d{13,19}\b/g, valid: luhn },
    { key: "TEL", label: "Téléphone", color: "#f0a020",
      re: new RegExp(`(?:\\+|(?<!\\d)00)[ ]?(?:${INDICATIFS.join("|")})[ .]?(?:\\(0\\)[ ]?)?\\d(?:[ .\\-/]?\\d){6,10}(?!\\d)|\\b0(?:[ .\\-/]?\\d){8,9}\\b`, "g"),
      valid: validTel },
    // Dates : jamais l'espace comme séparateur entre trois nombres (« +33 6 12 34 56 78 »
    // n'est pas deux dates) ; mois en toutes lettres FR et NL ; format ISO.
    { key: "DATE", label: "Date", color: "#b07cff",
      re: new RegExp(`${G}(?:\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]${AN}|\\d{1,2}(?:er|ème|e)?[\\/.\\- ]+(?:${MOIS})(?:\\.[ ]?|[\\/\\- ])${AN}|(?:19|20)\\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]))${D}`, "giu") },
    // « euros » AVANT « EUR » : sous le drapeau i, EUR l'emporterait et laisserait « os ».
    { key: "MONTANT", label: "Montant", color: "#0b9d63",
      re: new RegExp(`${G}\\d{1,3}(?:[ .\\u00a0\\u202f]?\\d{3})*(?:[,.]\\d{1,2})?\\s?(?:euros?|EUR|€)(?![\\p{L}])|${G}(?:€|EUR)[ \\u00a0]?\\d{1,3}(?:[ .\\u00a0\\u202f]?\\d{3})*(?:,\\d{1,2})?(?![\\p{N}])`, "giu") },
    // Après « n°, réf., dossier, matricule… » : sans le drapeau i sur la valeur, sinon
    // « dossier en-cours » en serait une (le validateur refuse les minuscules).
    { key: "REFERENCE", label: "Référence de dossier", color: "#94a3b8",
      re: new RegExp(`(?<=\\b(?:n°|nr\\.?|no\\.?|réf\\.?|référence|dossier|matricule|affilié|lidnummer|numéro|nummer)[ ]?(?:n°|nr\\.?)?[ ]?:?[ ]?)[A-Z0-9]{1,6}(?:[\\/\\-][A-Z0-9]{2,8}){1,3}(?![\\p{L}\\p{N}])`, "giu"),
      valid: validReference },
    { key: "CP_VILLE", label: "Code postal", color: "#2693ce",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])(?:[BLFD]-)?(?:[1-9]\\d{3}|\\d{5})[ ]+(?:(?:Sint|Saint|Sainte|Mont|Ter|Ten|Den|Bad|Le|La|Les)[ ])?${MOT_VILLE}(?:(?:-|['’])(?:${MOT_VILLE}|${PARTIE_VILLE})){0,4}${D}`, "gu"),
      valid: validCp },
    { key: "RUE", label: "Adresse (rue)", color: "#17b3a6",
      // rue française : mot-clé + nom propre (« dans la rue » n'en est pas une)
      re: new RegExp(`(?:${G}\\d{1,4}(?:[ ]?(?:bis|ter|[A-Za-z]))?,?[ ]+)?${G}(?:${VOIES_FR})[ ]+(?:${PARTICULES_RUE}[ ]?)?${L}[\\p{L}'’\\-]*(?:[ ](?:(?:du|de la|de|des|d['’]|la|le|l['’])[ ]?)?${L}[\\p{L}'’\\-]*){0,4}(?:,?[ ]+${NUM_RUE})?`, "gu"),
      // rue néerlandaise : suffixe, et le numéro est exigé
      aussi: [new RegExp(`${G}(?:(?:Lange|Korte|Grote|Kleine|Nieuwe|Oude|Groot|Klein|Sint|Onze-Lieve-Vrouw|Burgemeester|Koning|Koningin|Prins|Prinses|Kardinaal|Generaal|Pastoor|Dokter)[ ])?(?:${L}[\\p{L}'’\\-]{0,25}?(?:${SUFFIXES_NL})|Markt|Plein|Kaai|Lei|Dreef|Steenweg|Vest)[ ]+${NUM_RUE}`, "gu")] },
    { key: "PERSONNE", label: "Nom", color: "#ff7eb6",
      /* Le titre SERT à reconnaître le nom mais n'en fait pas partie : la valeur
         masquée est « Sophie Vandenberghe », pas « Madame Sophie Vandenberghe ».
         Sinon le même nom écrit SANS titre ailleurs (note de bas de page,
         signature, commentaire) restait en clair — constaté sur un contrat Word :
         « Madame Sophie Vandenberghe » masqué dans le corps, « Voir la fiche de
         Sophie Vandenberghe » intact dans la note. Le titre seul n'identifie
         personne, et « Madame [PERSONNE_1] » reste plus lisible pour une IA. */
      re: new RegExp(`(?<=${G}${TITRE}${SP}+)(?:${PARTICULE}${SP}?)?${NOM_MOT}(?:${SP}+(?:${PARTICULE}${SP}?)?${NOM_MOT}){0,3}`, "gu") },
    // Catégories alimentées par le modèle IA local (pas de regex) :
    { key: "LIEU", label: "Lieu / Adresse", color: "#2693ce", re: null, ner: true },
    { key: "ORG", label: "Organisation", color: "#c4b5fd", re: null, ner: true },
    // Termes désignés par l'utilisateur, sur le document ou au clavier :
    { key: "TERME", label: "Terme ajouté", color: "#8b5cf6", re: null, manuel: true },
  ];

  /* Mots à NE JAMAIS anonymiser (faux positifs fréquents : formes juridiques,
     sigles, fonctions). Comparés sans points : « S.R.L. » = « srl ». */
  const EXCLUDE = new Set(["rh", "sa", "sprl", "srl", "scrl", "scs", "snc", "asbl", "aisbl", "gie", "sc", "sca",
    "bv", "bvba", "nv", "vzw", "ivzw", "cvba", "gcv", "vof", "commv",
    "tva", "btw", "iban", "bce", "kbo", "direction", "directrice", "directeur", "service", "département", "contrat"]);

  /* Rattache un numéro de voirie au nom de rue (« 27 avenue Louise » et non
     « avenue Louise ») : cas d'une rue trouvée par le modèle IA. */
  const VOIES = /^(rue|avenue|av\.?|boulevard|bd\.?|chauss[ée]e|place|chemin|quai|impasse|all[ée]e|route|rte|dr[èe]ve|clos|square|sentier|venelle|galerie|parvis|cour)\b/i;
  function extendAddresses(text, hits) {
    hits.forEach(h => {
      if (h.cat !== "LIEU" || !VOIES.test(h.value)) return;
      const before = text.slice(Math.max(0, h.start - 10), h.start);
      const m = before.match(/(\d{1,4}(?:\s?(?:bis|ter))?)[ ,]+$/i);
      if (m) { h.start -= m[0].length; h.value = text.slice(h.start, h.end); }
    });
  }

  /* ------------------------------- détection ------------------------------ */

  /* Motif d'un terme ajouté à la main : jamais à l'intérieur d'un mot (« Anne »
     ne touche ni « annexe » ni « année »), mais toujours dans « REVOLia.be »
     ou une adresse e-mail (le point et l'arobase ne sont pas des lettres).
     Les espaces tolèrent un saut de ligne : un PDF coupe volontiers en fin de ligne. */
  function motifTerme(terme, drapeaux) {
    const motif = String(terme).trim().split(/\s+/).filter(Boolean).map(escapeRe).join("\\s+");
    if (!motif) return null;
    try { return new RegExp(G + motif + D, drapeaux || "giu"); } catch (e) { return null; }
  }
  function occurrencesTerme(text, terme) {
    const re = motifTerme(terme); if (!re) return 0;
    let n = 0, m;
    while ((m = re.exec(text)) !== null) { n++; if (m.index === re.lastIndex) re.lastIndex++; }
    return n;
  }

  /* options : { actives: {CAT: bool} (défaut : tout actif), termes: Set } */
  function detect(text, options) {
    const o = options || {};
    const actif = (k) => !o.actives || o.actives[k] !== false;
    const hits = [];
    CATS.forEach(c => {
      if (!c.re || !actif(c.key)) return;
      [c.re].concat(c.aussi || []).forEach(re => {
        let m; re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
          let val = m[0];
          if (val.trim().length < 2) { re.lastIndex = m.index + 1; continue; }
          if (c.valid) {
            const r = c.valid(val, text, m.index);
            if (r === false) { re.lastIndex = m.index + 1; continue; }
            if (typeof r === "number" && r > 0 && r < val.length) { val = val.slice(0, r); re.lastIndex = m.index + r; }
          }
          hits.push({ start: m.index, end: m.index + val.length, cat: c.key, value: val, prio: 2 });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      });
    });
    // termes désignés par l'utilisateur : priorité 3, ils l'emportent sur tout
    if (o.termes && actif("TERME")) o.termes.forEach(terme => {
      const re = motifTerme(terme); if (!re) return;
      let m;
      while ((m = re.exec(text)) !== null) {
        hits.push({ start: m.index, end: m.index + m[0].length, cat: "TERME", value: m[0], custom: true, prio: 3 });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    return dedup(hits);
  }

  // supprime les chevauchements ; priorité : terme perso > regex > IA, puis le plus long
  function dedup(hits) {
    hits.sort((a, b) => a.start - b.start || (b.prio || 1) - (a.prio || 1) || (b.end - b.start) - (a.end - a.start));
    const clean = []; let lastEnd = -1;
    hits.forEach(h => { if (h.start >= lastEnd) { clean.push(h); lastEnd = h.end; } });
    return clean.sort((a, b) => a.start - b.start);
  }

  /* Une valeur qu'on décide d'anonymiser doit l'être PARTOUT dans le document.
     Les règles trouvent déjà chaque occurrence, mais l'IA en rate : on ne
     masquait alors qu'une partie des occurrences. Même limite de mot que pour
     les termes : « Marc » n'est pas dans « marché ». */
  function completerOccurrences(text, hits) {
    const parValeur = new Map();
    for (const h of hits) {
      if (h.exclu) continue;
      const k = cle(h);
      if (!parValeur.has(k)) parValeur.set(k, h);
    }
    const ajouts = [];
    for (const modele of parValeur.values()) {
      const v = modele.value.trim();
      if (v.length < 3) continue;                   // trop court : trop de faux positifs
      const re = motifTerme(v, "gu");
      if (!re) continue;
      let m;
      while ((m = re.exec(text)) !== null) {
        const debut = m.index, fin = debut + m[0].length;
        // on n'ajoute que ce qui n'est pas déjà couvert par une détection
        if (!hits.some(h => h.start < fin && debut < h.end))
          ajouts.push({ cat: modele.cat, start: debut, end: fin, value: m[0],
                        prio: modele.prio, exclu: false, complete: true });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    return ajouts.length ? dedup(hits.concat(ajouts)) : hits;
  }

  /* ------------------------- table de jetons de SESSION ---------------------
     Un jeton, une fois attribué, désigne la même valeur jusqu'à ce qu'on vide la
     table (changement de document, bouton « Vider »). Les compteurs n'avancent
     que : écarter une détection laisse un trou dans la numérotation, mais
     [PERSONNE_2] ne devient jamais quelqu'un d'autre — sinon une réponse d'IA
     déjà obtenue serait ré-identifiée avec le mauvais nom, sans avertissement. */
  function creerTable() {
    const jetons = new Map(), valeurs = {}, compteurs = {};
    return {
      jeton(cat, valeur) {
        const k = cle({ cat, value: valeur });
        let t = jetons.get(k);
        if (!t) {
          compteurs[cat] = (compteurs[cat] || 0) + 1;
          t = "[" + cat + "_" + compteurs[cat] + "]";
          jetons.set(k, t); valeurs[t] = valeur;
        }
        return t;
      },
      /* jeton → valeur, pour TOUS les jetons attribués depuis le début de la session */
      correspondances() { return Object.assign({}, valeurs); },
      vider() { jetons.clear(); for (const k in valeurs) delete valeurs[k]; for (const k in compteurs) delete compteurs[k]; },
      get taille() { return jetons.size; },
    };
  }

  function attribuerJetons(hits, table) {
    hits.forEach(h => { h.token = table.jeton(h.cat, h.value); });
    return hits;
  }

  /* Tout le pipeline, sans DOM.
     options : { actives, termes, ner (détections IA ou null), exclusions (Set de clés),
                 completer (bool), table }
     Renvoie { tous (écartées comprises, marquées `exclu`), actifs (avec jetons) }. */
  function analyser(text, options) {
    const o = options || {};
    const actif = (k) => !o.actives || o.actives[k] !== false;
    let hits = detect(text, o);
    if (o.ner && o.ner.length) hits = hits.concat(o.ner.filter(h => actif(h.cat)).map(h => Object.assign({}, h)));
    extendAddresses(text, hits);
    hits = dedup(hits);
    // un terme désigné par l'utilisateur n'est jamais « exclu » : il l'a demandé (« Directrice »)
    hits = hits.filter(h => h.custom || !EXCLUDE.has(h.value.trim().toLowerCase().replace(/\./g, "")));
    const ecartees = o.exclusions || new Set();
    hits.forEach(h => { h.exclu = ecartees.has(cle(h)); });
    if (o.completer) hits = completerOccurrences(text, hits);
    const actifs = hits.filter(h => !h.exclu);
    if (o.table) attribuerJetons(actifs, o.table);
    return { tous: hits, actifs };
  }

  /* ---------------------- suggestions de noms (jamais masquées) ------------
     Une suite de mots capitalisés est un indice de nom propre — mais « Haute
     École » en fait partie : on PROPOSE, on ne masque rien d'office. */
  const MOT_CAPITALISE = `${L}${l}+(?:[-’']${L}?${l}+)*`;
  const PARTICULE_NOM = "(?:van|von|de|den|der|du|ter|ten|el|al)";
  const RE_NOMS = new RegExp(`${G}(${MOT_CAPITALISE}(?:[ ](?:${PARTICULE_NOM}[ ])*${MOT_CAPITALISE}){1,3})${D}`, "gu");
  // formules d'appel et titres : ils précèdent un nom sans en faire partie
  const MOTS_EN_TETE = new Set(["bonjour", "bonsoir", "salut", "cher", "chère", "chers", "chères", "beste", "geachte",
    "tussen", "entre", "madame", "monsieur", "mademoiselle", "mevrouw", "meneer", "dag", "hallo", "dear", "merci",
    "docteur", "dokter", "maître", "meester", "dr", "dhr", "mevr", "me", "prof", "professeur", "professor"]);

  function suggestionsDeNoms(text, hitsActifs, termes) {
    if (!text) return [];
    const norm = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
    // déjà couvert par une détection active, ou déjà ajouté à la main ?
    const connus = [...(hitsActifs || []).map(h => norm(h.value)), ...[...(termes || [])].map(norm)];
    const comptes = new Map();
    const re = new RegExp(RE_NOMS.source, RE_NOMS.flags);
    let m;
    while ((m = re.exec(text))) {
      let mots = m[1].split(" ");
      while (mots.length && MOTS_EN_TETE.has(mots[0].toLowerCase())) mots.shift();
      if (mots.filter(w => /^\p{Lu}/u.test(w)).length < 2) continue;   // un seul mot propre : pas un nom complet
      const v = mots.join(" ");
      comptes.set(v, (comptes.get(v) || 0) + 1);
    }
    return [...comptes.entries()]
      .filter(([v]) => { const n = norm(v); return !connus.some(c => c.includes(n) || n.includes(c)); })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([v, n]) => ({ v, n }));
  }

  /* ------------------------------ ré-identification ------------------------
     Une seule passe. Les variantes que produisent couramment les IA —
     « PERSONNE_1 » sans crochets, « [ personne_1 ] », « \[PERSONNE\_1\] » du
     markdown — ne sont reconnues QUE pour les jetons de la table. Un jeton
     de la forme [XXX_n] qui n'y est pas est signalé, jamais deviné. */
  const NOM_JETON = "[A-Za-z][A-Za-z]*(?:\\\\?_[A-Za-z]+)*\\\\?_\\d+";
  const RE_JETON = new RegExp(`\\\\?\\[\\s*(${NOM_JETON})\\s*\\\\?\\]|(?<![\\p{L}\\p{N}_])(${NOM_JETON})(?![\\p{L}\\p{N}_])`, "gu");
  const nomDeJeton = (t) => String(t).replace(/^\s*\\?\[\s*|\s*\\?\]\s*$/g, "").replace(/[\\\s]/g, "").toUpperCase();

  function reidentifier(src, correspondances) {
    const parNom = new Map();
    for (const [tok, val] of Object.entries(correspondances || {})) parNom.set(nomDeJeton(tok), { tok, val });
    const categories = new Set(CATS.map(c => c.key));
    const compte = new Map(), inconnus = new Set();
    let remplaces = 0, variantes = 0;
    const texte = String(src).replace(RE_JETON, (tout, entre, nu) => {
      const nom = nomDeJeton(entre || nu);
      const e = parNom.get(nom);
      if (e) {
        remplaces++; compte.set(nom, (compte.get(nom) || 0) + 1);
        if (tout !== e.tok) variantes++;
        return e.val;
      }
      // inconnu : un crochet ne suffit pas à faire un jeton (« [Note_1] »), il faut des
      // capitales, ou une catégorie que l'outil connaît
      const cat = nom.replace(/_\d+$/, "");
      const forme = entre ? (entre === entre.toUpperCase() || categories.has(cat)) : categories.has(cat);
      if (forme) inconnus.add("[" + nom + "]");
      return tout;
    });
    const absents = [];
    for (const [nom, e] of parNom) if (!compte.has(nom)) absents.push(e.tok);
    return { texte, remplaces, variantes, inconnus: [...inconnus], absents };
  }

  global.Regles = { CATS, EXCLUDE, cle, escapeRe, detect, dedup, completerOccurrences, extendAddresses,
                    analyser, creerTable, attribuerJetons, suggestionsDeNoms, reidentifier,
                    motifTerme, occurrencesTerme,
                    valid: { luhn, validTel, validNiss, validBce, validIban, validCp, validReference } };
})(globalThis);
