/* ===========================================================================
   Règles de détection — la partie PURE de l'anonymiseur (aucun accès au DOM).

   Sortie du gros <script> d'index.html pour deux raisons : pouvoir les tester
   sous Node (tests/regles.mjs mesure la couverture sur un corpus belge FR/NL),
   et ne plus avoir deux copies d'une même règle. Script classique, comme
   anon-geom.js : il installe `globalThis.Regles`.

   Contenu : catégories (expressions + validateurs, noms de jetons),
   exclusions, termes typés, détection, dédoublonnage, complétion des
   occurrences, table de jetons de SESSION, suggestions de noms et de parties
   de noms, ré-identification. Lit globalThis.CodesPostaux
   (js/codes-postaux.js) s'il est chargé.

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

     Avec la liste officielle (js/codes-postaux.js, BeST, CC BY 4.0) :
       · code belge connu → masqué, même si la localité ne lui correspond pas
         (« 9000 Gand » est un exonyme, « 9000 Sint Niklaas » une coquille : une
         adresse fausse reste une adresse) ;
       · code étranger plausible → masqué sans consulter la liste : préfixe
         « L- », « F- », « D- », « NL- », cinq chiffres (France, Allemagne) ou
         forme néerlandaise « 1234 AB Plaats » ;
       · quatre chiffres inconnus en Belgique → refusés s'ils ressemblent à une
         année (19xx, 20xx) ou si le mot qui suit est une localité BELGE
         (« 2024 Bruxelles » : 2024 n'est le code d'aucune localité) ; acceptés
         sinon (Luxembourg ou Suisse écrits sans préfixe : pas de fuite).
     Sans la liste (fichier absent), on garde les évidences ci-dessous. */
  const PAS_UNE_COMMUNE = new Set(("code rapport bilan budget exercice article annexe page chapitre section " +
    "total montant version tableau figure loi décret arrêté directive règlement norme décision note plan " +
    "année annee wallonie flandre belgique europe région region union vlaanderen wallonië belgië nederland " +
    "janvier février fevrier mars avril mai juin juillet août aout septembre octobre novembre décembre decembre " +
    "januari februari maart april mei juni juli augustus september oktober november december").split(" "));
  function validCp(v) {
    const m = v.match(/^(?:([A-Z]{1,2})-)?(\d{4,5})(?:[ ]?([A-Z]{2})(?=[ ]))?[ ]+(.+)$/su);
    if (!m) return false;
    const [, prefixe, code, lettresNL, ville] = m;
    const mots = ville.split(/[ \-'’]/);
    // « Le Roeulx », « Sint Niklaas » : le mot qui compte est le premier mot propre
    const premier = mots[0].toLowerCase();
    if (PAS_UNE_COMMUNE.has(premier)) return false;
    const C = global.CodesPostaux;
    if (!C) {
      if (/^(bruxelles|brussel|brussels)$/i.test(premier) && code.length === 4 && (+code < 1000 || +code > 1299)) return false;
      return true;
    }
    if ((prefixe && prefixe !== "B") || code.length === 5 || lettresNL) return true;   // chemin étranger
    if (C.estCode(code)) return true;
    if (/^(?:19|20)\d\d$/.test(code)) return false;                                  // une année
    if (C.estLocalite(ville) || C.estLocalite(mots[0])) return false;                 // localité belge, code faux
    return true;
  }

  /* Référence de dossier : il faut un chiffre et pas de minuscule (« dossier
     en-cours » ressemblait à une référence sous le drapeau i). */
  function validReference(v) { return /^[A-Z0-9\/\-]+$/.test(v) && /\d/.test(v); }

  /* Date de naissance : la même forme qu'une date, reconnue par ce qui la
     précède. Une date seule n'identifie personne ; une date de naissance, si.
       FR : « né le », « née le », « né(e) le », « né à Gand le »,
            « date de naissance : », « Lieu et date de naissance : Gand, »,
            « naissance : », « ° » (mais pas « n° »)
       NL : « geboren op », « geboren te Brugge op », « geboren: »,
            « geboortedatum: »
     Un formulaire met volontiers le libellé sur sa ligne et la valeur sur la
     suivante (« Date de naissance\n03/07/1989 », mesuré sur fiche-reelle.pdf) :
     UN saut de ligne est admis juste avant la date. Sinon la portée est courte
     et ne franchit ni un saut de ligne ni un chiffre :
     « Lieu de naissance : Gand. Engagé le 01/03/2025 » ne doit pas faire de la
     date d'engagement une date de naissance. */
  const NE = "n[ée]e?(?:[ \\u00a0]?\\([ée]?e\\))?";
  const CONTEXTE_NAISSANCE = new RegExp("(?:" + [
    `(?<!\\p{L})${NE}(?:[ \\u00a0]+[àa][ \\u00a0]+[^\\n\\d]{1,40}?)?,?[ \\u00a0]+le`,
    `(?<!\\p{L})(?:date|jour)[ \\u00a0]+de[ \\u00a0]+naissance[^\\n\\d]{0,30}`,
    `(?<!\\p{L})naissance[ \\u00a0]*(?::|(?=\\n))`,
    `(?<!\\p{L})geboren(?:[ \\u00a0]+te[ \\u00a0]+[^\\n\\d]{1,40}?)?,?[ \\u00a0]+op`,
    `(?<!\\p{L})geboren[ \\u00a0]*(?::|(?=\\n))`,
    `(?<!\\p{L})geboortedatum[^\\n\\d]{0,30}`,
    `(?<![nN])°`,
  ].join("|") + ")[ \\u00a0(]*[:\\-]?[ \\u00a0]*(?:\\n[ \\u00a0]*)?$", "iu");
  function validNaissance(v, text, i) {
    return CONTEXTE_NAISSANCE.test(text.slice(Math.max(0, i - 70), i));
  }

  /* N° de puce électronique (ISO 11784) : 15 chiffres, dont les 3 premiers sont
     un code pays ISO 3166 (056 Belgique, 250 France, 528 Pays-Bas…) ou un code
     fabricant (900 à 998). Pas de clé de contrôle : le préfixe est le seul
     indice, d'où trois garde-fous.
       · un nombre plus long (carte à 16 chiffres, référence) n'est pas une puce :
         le motif refuse un chiffre collé, ou séparé d'une espace, avant et après ;
       · une carte American Express (15 chiffres, 34… ou 37…, clé de Luhn juste)
         reste une carte ;
       · après « réf. », « commande », « facture », « EAN »… c'est un numéro de
         référence, sauf si un mot de puce (« puce », « transpondeur », « chip »)
         le précède aussi. */
  const PAYS_PUCE = new Set(("040 056 100 191 196 203 208 233 246 250 276 300 348 352 372 380 428 438 440 " +
    "442 470 492 504 528 578 616 620 642 703 705 724 752 756 792 826 840 124 012 788 036 554").split(" "));
  function validPuce(v, text, i) {
    const d = v.replace(/\D/g, "");
    if (d.length !== 15) return false;
    const pre = d.slice(0, 3);
    if (!PAYS_PUCE.has(pre) && !(+pre >= 900 && +pre <= 998)) return false;
    if (/^3[47]/.test(d) && luhn(d)) return false;
    const avant = text.slice(Math.max(0, i - 40), i);
    if (/puce|transpondeur|chip|identification|i-?cad|dogid|catid/i.test(avant)) return true;
    return !/r[ée]f|r[ée]f[ée]rence|commande|facture|bestel|factuur|EAN|GTIN|colis|suivi|tracking|order|n°[ ]?de[ ]?(?:lot|s[ée]rie)/i.test(avant);
  }

  /* --------------------- e-mails : une recherche linéaire ------------------
     L'expression d'origine, `[A-Za-z0-9._%+\-]+@…`, est QUADRATIQUE : sur une
     suite de 12 000 caractères admis dans une adresse mais sans « @ » (un bloc
     base64, une longue référence), le moteur repart de chaque position et
     relit toute la suite — 500 ms mesurées, un quart de seconde de plus à
     chaque doublement de longueur. Or toutes les positions d'une même suite
     donnent le même résultat : la partie locale, gourmande, finit forcément au
     premier caractère hors de la classe, et la suite est la même. On essaie
     donc chaque suite UNE fois (depuis sa première position, ou depuis
     lastIndex si l'on reprend au milieu, comme le moteur), et l'on confie la
     fin (« @domaine.tld », « (at) domaine.org ») à une expression ancrée
     (drapeau `y`) essayée une fois par suite.
     Même interface qu'une RegExp globale pour detect() : lastIndex et exec().
     tests/regles.mjs compare le résultat à l'expression d'origine sur des
     milliers de chaînes aléatoires, et chronomètre les entrées pathologiques. */
  function rechercheParSuites(classe, fin, source) {
    return {
      lastIndex: 0, global: true, source,
      exec(text) {
        const t = String(text);
        let i = this.lastIndex;
        while (i < t.length) {
          if (!classe.test(t[i])) { i++; continue; }
          let e = i + 1;
          while (e < t.length && classe.test(t[e])) e++;
          fin.lastIndex = e;
          const m = fin.exec(t);
          if (m) {
            const r = [t.slice(i, e + m[0].length)];
            r.index = i; r.input = t;
            this.lastIndex = e + m[0].length;
            return r;
          }
          i = e;
        }
        this.lastIndex = 0;
        return null;
      },
    };
  }
  const RE_EMAIL = rechercheParSuites(/[A-Za-z0-9._%+\-]/, /@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/y,
    "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}");
  // écrit à la main pour tromper les robots : « x (at) exemple.org »
  const RE_EMAIL_AT = rechercheParSuites(/[\w.+-]/,
    /[ ]*[\[(][ ]*(?:at|arobase)[ ]*[\])][ ]*[\w-]+(?:[ ]*(?:\.|[\[(][ ]*(?:dot|point)[ ]*[\])])[ ]*[\w-]+)+/iy,
    "[\\w.+-]+[ ]*[\\[(][ ]*(?:at|arobase)[ ]*[\\])][ ]*[\\w-]+(?:[ ]*(?:\\.|[\\[(][ ]*(?:dot|point)[ ]*[\\])])[ ]*[\\w-]+)+");

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

  // Dates : jamais l'espace comme séparateur entre trois nombres (« +33 6 12 34 56 78 »
  // n'est pas deux dates) ; mois en toutes lettres FR et NL ; format ISO.
  const RE_DATE = `${G}(?:\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]${AN}|\\d{1,2}(?:er|ème|e)?[\\/.\\- ]+(?:${MOIS})(?:\\.[ ]?|[\\/\\- ])${AN}|(?:19|20)\\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]))${D}`;

  /* Couleurs : au moins 4,5:1 sur leur surlignage (fond à 20 %), rangées par
     famille pour rester distinctes.

     `defaut: false` : catégorie DÉCOCHÉE dans les réglages par défaut. Un
     montant ou une date ordinaire n'identifie personne à lui seul, et c'est
     souvent exactement ce que l'utilisateur veut faire analyser (mesuré sur un
     devis réel : 8 des 12 valeurs masquées étaient des montants). Les profils
     métier (PROFILS, plus bas) partent de ces défauts.

     `prio` : priorité dans le dédoublonnage (terme ajouté 3, règle 2, IA 1).

     `jeton` : le nom écrit dans le document, [N_ENTREPRISE_1]. Il est distinct de
     la clé (`key`, interne : cases, profils, couleurs, tests) parce que la clé
     parle au code et le jeton à l'IA et au lecteur : [CP_VILLE_1] ou
     [TVA_BE_1] se comprenaient mal, et la réponse de l'IA en pâtissait.
     Majuscules, chiffres et soulignés seulement : pas d'accent, pour qu'une IA
     le recopie sans le déformer. Deux catégories ne partagent jamais un nom. */
  const CATS = [
    { key: "EMAIL", label: "E-mail", color: "#1755d1", jeton: "EMAIL",
      re: RE_EMAIL, aussi: [RE_EMAIL_AT] },
    { key: "IBAN", label: "IBAN", color: "#0c6e2d", jeton: "IBAN",
      re: new RegExp(`${G}[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?${D}`, "gu"), valid: validIban },
    { key: "NISS", label: "N° national", color: "#b51414", jeton: "N_NATIONAL",
      re: /\b\d{2}[.\-]?\d{2}[.\-]?\d{2}[.\- ]?\d{3}[.\-]?\d{2}\b/g, valid: validNiss },
    { key: "TVA_BE", label: "N° entreprise (BE)", color: "#7e590e", jeton: "N_ENTREPRISE",
      re: new RegExp(`(?<![\\p{L}\\p{N}.,])(?:BE[ ]?)?[01]\\d{3}[. ]?\\d{3}[. ]?\\d{3}(?![\\p{N}]|[.,]\\d)`, "giu"), valid: validBce },
    { key: "INAMI", label: "N° INAMI / RIZIV", color: "#a112a1", jeton: "N_INAMI",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])[1-9]-\\d{5}-\\d{2}-\\d{3}(?![\\p{N}-])|(?<=(?:INAMI|RIZIV)[^\\n\\d]{0,20})(?<!\\d)\\d{11}(?!\\d)`, "giu") },
    { key: "PLAQUE", label: "Plaque d’immatriculation", color: "#63630b", jeton: "PLAQUE",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])[1-9]-[A-Z]{3}-\\d{3}(?![\\p{L}\\p{N}-])`, "gu") },
    { key: "CARTE_ID", label: "Carte d’identité", color: "#b31449", jeton: "CARTE_IDENTITE",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])\\d{3}-\\d{7}-\\d{2}(?![\\p{N}-])`, "gu") },
    // Avant CARTE : à égalité (15 chiffres d'une puce qui passent par hasard la
    // clé de Luhn), c'est une puce. Écritures groupées : « 981 000 012 345 678 ».
    { key: "PUCE", label: "N° de puce électronique", color: "#0b5c78", jeton: "PUCE_ANIMAL",
      re: new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\d[ \\u00a0])\\d(?:[ \\u00a0]?\\d){14}(?![\\p{L}\\p{N}])(?![ \\u00a0]\\d)`, "gu"),
      valid: validPuce },
    { key: "CARTE", label: "Carte bancaire", color: "#9e4112", jeton: "CARTE_BANCAIRE",
      re: /\b\d{4}[ \-]\d{4}[ \-]\d{4}[ \-]\d{2,7}\b|\b\d{13,19}\b/g, valid: luhn },
    { key: "TEL", label: "Téléphone", color: "#4343ea", jeton: "TELEPHONE",
      re: new RegExp(`(?:\\+|(?<!\\d)00)[ ]?(?:${INDICATIFS.join("|")})[ .]?(?:\\(0\\)[ ]?)?\\d(?:[ .\\-/]?\\d){6,10}(?!\\d)|\\b0(?:[ .\\-/]?\\d){8,9}\\b`, "g"),
      valid: validTel },
    /* Date de naissance : même motif que DATE, plus un mot de contexte devant.
       Elle doit l'emporter sur DATE pour la même valeur : DATE est décochée par
       défaut, une date de naissance classée DATE resterait EN CLAIR. D'où une
       priorité au-dessus des autres règles (2.5), qui ne dépend pas de l'ordre
       de ce tableau ni de celui du tri. */
    { key: "DATE_NAISSANCE", label: "Date de naissance", color: "#4b2a99", jeton: "DATE_NAISSANCE", prio: 2.5,
      re: new RegExp(RE_DATE, "giu"), valid: validNaissance },
    { key: "DATE", label: "Date", color: "#6c2ee8", jeton: "DATE", defaut: false,
      re: new RegExp(RE_DATE, "giu") },
    // « euros » AVANT « EUR » : sous le drapeau i, EUR l'emporterait et laisserait « os ».
    { key: "MONTANT", label: "Montant", color: "#2c6c0c", jeton: "MONTANT", defaut: false,
      re: new RegExp(`${G}\\d{1,3}(?:[ .\\u00a0\\u202f]?\\d{3})*(?:[,.]\\d{1,2})?\\s?(?:euros?|EUR|€)(?![\\p{L}])|${G}(?:€|EUR)[ \\u00a0]?\\d{1,3}(?:[ .\\u00a0\\u202f]?\\d{3})*(?:,\\d{1,2})?(?![\\p{N}])`, "giu") },
    // Après « n°, réf., dossier, matricule… » : sans le drapeau i sur la valeur, sinon
    // « dossier en-cours » en serait une (le validateur refuse les minuscules).
    { key: "REFERENCE", label: "Référence de dossier", color: "#49670b", jeton: "REFERENCE",
      re: new RegExp(`(?<=\\b(?:n°|nr\\.?|no\\.?|réf\\.?|référence|dossier|matricule|affilié|lidnummer|numéro|nummer)[ ]?(?:n°|nr\\.?)?[ ]?:?[ ]?)[A-Z0-9]{1,6}(?:[\\/\\-][A-Z0-9]{2,8}){1,3}(?![\\p{L}\\p{N}])`, "giu"),
      valid: validReference },
    { key: "CP_VILLE", label: "Code postal", color: "#10648e", jeton: "LOCALITE",
      re: new RegExp(`(?<![\\p{L}\\p{N}-])(?:[BLFD]-|NL-)?(?:[1-9]\\d{3}(?:[ ]?[A-Z]{2}(?=[ ]))?|\\d{5})[ ]+(?:(?:Sint|Saint|Sainte|Mont|Ter|Ten|Den|Bad|Le|La|Les)[ ])?${MOT_VILLE}(?:(?:-|['’])(?:${MOT_VILLE}|${PARTIE_VILLE})){0,4}${D}`, "gu"),
      valid: validCp },
    { key: "RUE", label: "Adresse (rue)", color: "#0c6a6a", jeton: "ADRESSE",
      // rue française : mot-clé + nom propre (« dans la rue » n'en est pas une)
      re: new RegExp(`(?:${G}\\d{1,4}(?:[ ]?(?:bis|ter|[A-Za-z]))?,?[ ]+)?${G}(?:${VOIES_FR})[ ]+(?:${PARTICULES_RUE}[ ]?)?${L}[\\p{L}'’\\-]*(?:[ ](?:(?:du|de la|de|des|d['’]|la|le|l['’])[ ]?)?${L}[\\p{L}'’\\-]*){0,4}(?:,?[ ]+${NUM_RUE})?`, "gu"),
      // rue néerlandaise : suffixe, et le numéro est exigé
      aussi: [new RegExp(`${G}(?:(?:Lange|Korte|Grote|Kleine|Nieuwe|Oude|Groot|Klein|Sint|Onze-Lieve-Vrouw|Burgemeester|Koning|Koningin|Prins|Prinses|Kardinaal|Generaal|Pastoor|Dokter)[ ])?(?:${L}[\\p{L}'’\\-]{0,25}?(?:${SUFFIXES_NL})|Markt|Plein|Kaai|Lei|Dreef|Steenweg|Vest)[ ]+${NUM_RUE}`, "gu")] },
    { key: "PERSONNE", label: "Nom", color: "#ac1379", jeton: "PERSONNE",
      /* Le titre SERT à reconnaître le nom mais n'en fait pas partie : la valeur
         masquée est « Sophie Vandenberghe », pas « Madame Sophie Vandenberghe ».
         Sinon le même nom écrit SANS titre ailleurs (note de bas de page,
         signature, commentaire) restait en clair — constaté sur un contrat Word :
         « Madame Sophie Vandenberghe » masqué dans le corps, « Voir la fiche de
         Sophie Vandenberghe » intact dans la note. Le titre seul n'identifie
         personne, et « Madame [PERSONNE_1] » reste plus lisible pour une IA. */
      re: new RegExp(`(?<=${G}${TITRE}${SP}+)(?:${PARTICULE}${SP}?)?${NOM_MOT}(?:${SP}+(?:${PARTICULE}${SP}?)?${NOM_MOT}){0,3}`, "gu") },
    // Catégories alimentées par le modèle IA local (pas de regex) :
    { key: "LIEU", label: "Lieu / Adresse", color: "#0c6c4c", jeton: "LIEU", re: null, ner: true },
    { key: "ORG", label: "Organisation", color: "#8e16ca", jeton: "ORGANISATION", re: null, ner: true },
    // Termes désignés par l'utilisateur, sur le document ou au clavier :
    { key: "TERME", label: "Terme ajouté", color: "#3e3e50", jeton: "TERME", re: null, manuel: true },
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

  /* ---------------------------- termes typés -------------------------------
     Un terme ajouté à la main devenait [TERME_n] : ni l'IA ni le lecteur ne
     savaient ce qu'il cachait. L'utilisateur dit d'un clic ce que c'est ; le
     jeton suit. « Autre » garde [TERME_n]. */
  const TYPES_TERME = [
    { id: "PERSONNE", label: "Personne", jeton: "PERSONNE" },
    { id: "ORGANISATION", label: "Organisation", jeton: "ORGANISATION" },
    { id: "LIEU", label: "Lieu", jeton: "LIEU" },
    { id: "AUTRE", label: "Autre", jeton: "TERME" },
  ];
  function typeTerme(id) { return TYPES_TERME.find(t => t.id === id) || TYPES_TERME[TYPES_TERME.length - 1]; }

  /* Type proposé à l'ajout. Une seule règle, parce qu'elle ne se trompe pas :
     un terme qui FINIT par une forme juridique (« BelgaTech SPRL »,
     « Bakkerij Verhaegen BV ») est une organisation. Pour le reste (« Dupont »
     est-il une personne, une rue, une société ?) on ne devine pas : « Autre ». */
  const FORME_JURIDIQUE = /[  ](?:S\.?R\.?L|S\.?P\.?R\.?L|S\.?A|S\.?C\.?R\.?L|S\.?C|A\.?S\.?B\.?L|A\.?I\.?S\.?B\.?L|S\.?N\.?C|S\.?C\.?S|B\.?V\.?B\.?A|B\.?V|N\.?V|V\.?Z\.?W|C\.?V\.?B\.?A|C\.?V|GmbH|SARL|SAS|Ltd|Inc)\.?$/;
  function typeTermeParDefaut(terme) {
    const t = String(terme || "").trim();
    return FORME_JURIDIQUE.test(t) && /\p{L}{2}/u.test(t.replace(FORME_JURIDIQUE, "")) ? "ORGANISATION" : "AUTRE";
  }

  /* Ensemble de termes qui retient le type de chacun (et, pour une partie de
     nom acceptée, la personne dont il est une partie). C'est un Set : add, has,
     delete, clear, size, l'itération restent ceux d'avant ; delete et clear
     oublient aussi le type. */
  function creerTermes() {
    const infos = new Map();
    class Termes extends Set {
      add(t) { if (!infos.has(t)) infos.set(t, { type: typeTermeParDefaut(t) }); return super.add(t); }
      delete(t) { infos.delete(t); return super.delete(t); }
      clear() { infos.clear(); return super.clear(); }
      /* { type, aliasDe } — aliasDe : valeur d'une personne déjà masquée */
      info(t) { return Object.assign({ type: "AUTRE" }, infos.get(t)); }
      definir(t, info) {
        const i = Object.assign({}, infos.get(t) || { type: "AUTRE" }, info || {});
        if (!TYPES_TERME.some(x => x.id === i.type)) i.type = "AUTRE";
        if (i.type !== "PERSONNE") delete i.aliasDe;
        infos.set(t, i);
      }
    }
    return new Termes();
  }
  /* Un Set ordinaire (tests, anciens appels) : tous ses termes sont « Autre ». */
  function infoTerme(termes, t) {
    return termes && typeof termes.info === "function" ? termes.info(t) : { type: "AUTRE" };
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
          hits.push({ start: m.index, end: m.index + val.length, cat: c.key, value: val, prio: c.prio || 2 });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      });
    });
    // termes désignés par l'utilisateur : priorité 3, ils l'emportent sur tout.
    // Leur TYPE (Personne, Organisation, Lieu, Autre) ne change que le nom du
    // jeton : la catégorie reste TERME (case, couleur, récapitulatif).
    if (o.termes && actif("TERME")) o.termes.forEach(terme => {
      const re = motifTerme(terme); if (!re) return;
      const info = infoTerme(o.termes, terme);
      let m;
      while ((m = re.exec(text)) !== null) {
        const h = { start: m.index, end: m.index + m[0].length, cat: "TERME", value: m[0], custom: true, prio: 3,
                    nomJeton: typeTerme(info.type).jeton };
        if (info.aliasDe && info.type === "PERSONNE") h.aliasDe = info.aliasDe;
        hits.push(h);
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
  /* « Cette zone touche-t-elle une détection ? » en temps constant : sommes
     cumulées des caractères couverts. Le test naïf (chaque occurrence contre
     chaque détection) était quadratique : 244 ms pour un terme présent 12 000
     fois dans 48 000 caractères. */
  function couverture(text, hits) {
    const n = String(text).length, marque = new Uint8Array(n + 1), cum = new Int32Array(n + 1);
    for (const h of hits) for (let k = Math.max(0, h.start); k < Math.min(n, h.end); k++) marque[k] = 1;
    for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + marque[k];
    return (debut, fin) => cum[Math.min(n, fin)] - cum[Math.max(0, Math.min(n, debut))] > 0;
  }

  function completerOccurrences(text, hits) {
    const touche = couverture(text, hits);
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
        if (!touche(debut, fin))
          ajouts.push(Object.assign({ cat: modele.cat, start: debut, end: fin, value: m[0],
                        prio: modele.prio, exclu: false, complete: true },
                        modele.nomJeton ? { nomJeton: modele.nomJeton } : {},
                        modele.aliasDe ? { aliasDe: modele.aliasDe } : {}));
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
     déjà obtenue serait ré-identifiée avec le mauvais nom, sans avertissement.

     La clé est le NOM DU JETON (pas la catégorie) + la valeur, et les compteurs
     vont par nom de jeton : « Dupont » détecté derrière « Monsieur » et
     « Dupont » ajouté à la main comme Personne reçoivent le même [PERSONNE_1],
     et un terme Personne ne peut pas reprendre le numéro d'une personne
     détectée. Les clés internes ayant chacune un nom distinct, rien ne change
     pour les catégories des règles.

     Alias : une PARTIE d'un nom déjà masqué (« N. Mertens » pour « Nathalie
     Mertens ») peut recevoir le jeton de la personne. Plusieurs valeurs pour un
     jeton, mais un jeton pour UNE valeur : la table exportée garde
     [PERSONNE_1] → « Nathalie Mertens », et la ré-identification rend le nom
     complet. */
  function nomJeton(cat) { return (CATS.find(c => c.key === cat) || {}).jeton || String(cat); }
  function creerTable() {
    const jetons = new Map(), valeurs = {}, compteurs = {};
    const k = (nom, valeur) => cle({ cat: nom, value: valeur });
    const table = {
      jeton(cat, valeur, nom) {
        const n = nom || nomJeton(cat);
        let t = jetons.get(k(n, valeur));
        if (!t) {
          compteurs[n] = (compteurs[n] || 0) + 1;
          t = "[" + n + "_" + compteurs[n] + "]";
          jetons.set(k(n, valeur), t); valeurs[t] = valeur;
        }
        return t;
      },
      /* `valeur` (une partie) reçoit le jeton de `cible` (la personne entière) ;
         une valeur qui a déjà son propre jeton le garde (jetons stables). */
      alias(valeur, cible, nom) {
        const n = nom || "PERSONNE";
        const deja = jetons.get(k(n, valeur));
        if (deja) return deja;
        const t = table.jeton(null, cible, n);
        jetons.set(k(n, valeur), t);
        return t;
      },
      /* jeton → valeur, pour TOUS les jetons attribués depuis le début de la session */
      correspondances() { return Object.assign({}, valeurs); },
      vider() { jetons.clear(); for (const x in valeurs) delete valeurs[x]; for (const x in compteurs) delete compteurs[x]; },
      /* nombre de jetons (un alias n'en crée pas) */
      get taille() { return Object.keys(valeurs).length; },
    };
    return table;
  }

  function attribuerJetons(hits, table) {
    hits.forEach(h => {
      h.token = h.aliasDe ? table.alias(h.value, h.aliasDe, h.nomJeton)
                          : table.jeton(h.cat, h.value, h.nomJeton);
    });
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
  // Au plus 4 tirets ou apostrophes dans un mot : sans borne, un long mot à
  // tirets (« Abc-Abc-… », 48 000 caractères) coûtait 427 ms, chaque morceau
  // relisant la suite. Aucun nom réel n'en a plus de quatre.
  const MOT_CAPITALISE = `${L}${l}+(?:[-’']${L}?${l}+){0,4}`;
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
    const connus = [...new Set([...(hitsActifs || []).map(h => norm(h.value)), ...[...(termes || [])].map(norm)])];
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

  /* ----------------- parties d'un nom déjà masqué (suggestions) -------------
     « Pieter De Smet » masqué, « Beste Pieter », « Cabinet vétérinaire
     Janssens » ou « N. Mertens » restaient en clair. Quand un nom de personne
     est masqué, on cherche ses PARTIES écrites seules : prénom, nom de famille
     (avec sa particule), initiale + nom. Une adresse e-mail masquée de la forme
     prenom.nom@ ou p.nom@ compte aussi comme un nom connu (« Bonjour Thomas »
     sous thomas.mathieu@…). Ce sont des SUGGESTIONS : rien n'est masqué d'office.

     Règle contre le bruit (mesurée sur le corpus et les textes neutres) :
       · la partie commence par une majuscule, fait au moins 3 lettres, et
         n'est ni une formule (« Beste »), ni une particule ;
       · elle n'est pas collée à un AUTRE nom : « Youssef Benali » n'est pas une
         partie d'« Aïcha Benali », « Kris Janssens » pas une partie de « Pieter
         Janssens » (un mot capitalisé ou une particule juste avant, ou après un
         prénom, l'exclut — sauf formule d'appel, titre ou enseigne :
         « Beste Pieter », « Cabinet Janssens ») ;
       · si le mot existe en minuscules dans le texte (« la pierre », « une
         rose »), on ne le propose pas : un terme ajouté se masque sans tenir
         compte de la casse, il abîmerait ces mots-là ;
       · s'il est aussi un mot courant (liste ci-dessous : Rose, Blanche,
         Pierre, Renard, De Vos…) ou une localité belge, il faut un indice
         devant : formule, titre, enseigne, initiale.
     Limites : un prénom courant en début de phrase sans indice (« Pierre a
     signé ») n'est pas proposé ; un prénom composé écrit autrement (« J.-P. »)
     non plus ; on ne sait pas qu'« Annelies » et « Lies » sont la même personne. */
  const MOTS_ENSEIGNE = new Set(("cabinet bureau atelier boulangerie boucherie pharmacie clinique garage maison famille " +
    "société societe établissements etablissements ets étude etude fiduciaire groupe entreprise entreprises notaire " +
    "bakkerij slagerij apotheek kantoor praktijk dierenartsenpraktijk firma familie huis brasserie café restaurant " +
    "institut fondation villa résidence residence").split(" "));
  // prénoms et noms de famille qui sont aussi des mots courants (FR, NL)
  const NOMS_MOTS = new Set(("rose blanche pierre olive violette marguerite capucine iris jade ambre perle aurore celeste " +
    "colombe prudence constance clemence patience esperance france florence victoire ange aime desire constant olivier " +
    "laurier marc jean martin petit blanc leblanc lebrun brun roux noir grand legrand roy leroy lion loup renard lievre " +
    "boulanger mercier berger meunier masson marchal fontaine riviere dubois delbois " +
    "vos devos wolf dewolf bakker debakker backer debacker smet desmet smid visser koning dekoning mulder witte dewitte " +
    "wit groot degroot jong dejong klein deklein bruyne debruyne bruin keyser dekeyser wilde dewilde meyer demeyer " +
    "clercq declercq vogel devogel boer deboer haan dehaan").split(" "));
  const PARTICULES_SET = new Set(["van", "von", "de", "den", "der", "du", "ter", "ten", "el", "al", "d", "di", "da", "vanden", "vander"]);
  const EMAIL_GENERIQUE = new Set(("info contact admin service secretariat compta comptabilite rh hr noreply no reply office " +
    "direction accueil support sales team bureau facturation factuur boekhouding personeel onthaal").split(" "));
  const lettresDe = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

  function decomposerNom(valeur) {
    const mots = String(valeur).trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return null;
    const caps = (w) => /^\p{Lu}{2,}(?:-\p{Lu}{2,})*$/u.test(w);
    if (mots.length === 1) return { prenom: null, famille: lettresDe(mots[0]) };
    // « DUPONT Marie-Claire » : nom en capitales d'abord
    if (caps(mots[0]) && !caps(mots[mots.length - 1])) {
      let j = 0; while (j < mots.length && caps(mots[j])) j++;
      return { prenom: lettresDe(mots[j]), famille: lettresDe(mots.slice(0, j).join("")) };
    }
    // « Van den Broeck » : une particule en tête, c'est un nom de famille seul
    if (PARTICULES_SET.has(mots[0].toLowerCase())) return { prenom: null, famille: lettresDe(mots.join("")) };
    // prénom = premier mot ; nom = dernier mot et les particules qui le précèdent
    let j = mots.length - 1;
    while (j > 1 && PARTICULES_SET.has(mots[j - 1].toLowerCase())) j--;
    return { prenom: lettresDe(mots[0]), famille: lettresDe(mots.slice(j).join("")) };
  }
  function nomDepuisEmail(valeur) {
    const local = String(valeur).split(/[@\s\[(]/)[0];
    const m = local.match(/^([A-Za-z]+)[._]([A-Za-z]+(?:-[A-Za-z]+)?)$/);
    if (!m || EMAIL_GENERIQUE.has(m[1].toLowerCase()) || EMAIL_GENERIQUE.has(m[2].toLowerCase())) return null;
    const p = lettresDe(m[1]), f = lettresDe(m[2]);
    if (f.length < 3) return null;
    return p.length === 1 ? { prenom: null, initiale: p, famille: f } : { prenom: p, famille: f };
  }

  function suggestionsDeParties(text, hitsActifs, termes) {
    if (!text) return [];
    const hits = hitsActifs || [];
    const couvert = couverture(text, hits);
    // personnes connues : noms masqués (règle, IA, terme de type Personne), e-mails prenom.nom@
    const personnes = [], vues = new Set();
    for (const h of hits) {
      const estNom = h.cat === "PERSONNE" || h.nomJeton === "PERSONNE";
      const d = estNom ? decomposerNom(h.value) : h.cat === "EMAIL" ? nomDepuisEmail(h.value) : null;
      if (!d || !d.famille) continue;
      const k = (estNom ? "n:" + lettresDe(h.value) : "e:" + d.prenom + "." + d.initiale + "." + d.famille);
      if (vues.has(k)) continue;
      vues.add(k);
      personnes.push(Object.assign({ valeur: h.value, source: estNom ? "nom" : "email" }, d));
    }
    if (!personnes.length) return [];
    // les mots du texte, avec leur position
    const mots = [];
    const reMot = /\p{L}+(?:['’-]\p{L}+)*/gu;
    let m;
    while ((m = reMot.exec(text))) mots.push({ s: m.index, e: m.index + m[0].length, w: m[0], n: lettresDe(m[0]),
      cap: /^\p{Lu}/u.test(m[0]), bas: !/\p{Lu}/u.test(m[0]) });
    const colles = (a, b) => /^[  ]+$/.test(text.slice(a.e, b.s));
    const minuscules = new Set(mots.filter(x => x.bas && !couvert(x.s, x.e)).map(x => x.n));
    const deNom = (x) => x.cap || PARTICULES_SET.has(x.w.toLowerCase());
    const formule = (x) => MOTS_EN_TETE.has(x.w.toLowerCase()) || MOTS_ENSEIGNE.has(x.w.toLowerCase());
    const C = global.CodesPostaux;
    const courant = (n, w) => NOMS_MOTS.has(n) || !!(C && C.estLocalite(w));
    // la suite de mots à partir de i qui épelle `famille` (1 à 3 mots collés)
    const famille = (i, f) => {
      let acc = "";
      for (let k = i; k < Math.min(i + 3, mots.length); k++) {
        if (k > i && !colles(mots[k - 1], mots[k])) return -1;
        acc += mots[k].n;
        if (acc === f) return mots[k].cap ? k : -1;
        if (!f.startsWith(acc)) return -1;
      }
      return -1;
    };
    const groupes = new Map();
    const noter = (s, e, p, aliasOk, indice, mot) => {
      if (couvert(s, e)) return;
      const nm = lettresDe(mot);
      if (nm.length < 3 || MOTS_EN_TETE.has(mot.toLowerCase()) || EXCLUDE.has(mot.toLowerCase())) return;
      const v = text.slice(s, e).replace(/\s+/g, " ");
      const nu = v === mot;                      // forme nue (sans initiale devant)
      if (nu && minuscules.has(nm)) return;      // « la pierre » serait masqué avec « Pierre »
      if (courant(nm, mot) && !indice) return;
      const k = v.toLowerCase();
      const g = groupes.get(k) || { v, n: 0, positions: new Set(), personnes: new Set(), aliasOk: true, sources: new Set() };
      if (!g.positions.has(s)) { g.positions.add(s); g.n++; }  // deux adresses de la même personne : une occurrence
      g.personnes.add(p.valeur); g.sources.add(p.source); g.aliasOk = g.aliasOk && aliasOk;
      groupes.set(k, g);
    };
    for (let i = 0; i < mots.length; i++) {
      const t = mots[i];
      const prev = i > 0 ? mots[i - 1] : null;
      for (const p of personnes) {
        // nom de famille, seul ou après une initiale
        const j = famille(i, p.famille);
        if (j >= 0) {
          const fin = mots[j].e, mot = text.slice(t.s, fin);
          if (prev && prev.w.length === 1 && prev.cap && /^\.[  ]*$/.test(text.slice(prev.e, t.s))) {
            const ini = prev.n;
            const ok = p.prenom ? p.prenom[0] === ini : p.initiale === ini;
            if (ok) noter(prev.s, fin, p, true, true, mot);
          } else if (prev && colles(prev, t) && deNom(prev)) {
            if (formule(prev)) noter(t.s, fin, p, true, true, mot);
            // sinon : le nom complet (déjà masqué, ou proposé ailleurs) ou un AUTRE nom
          } else noter(t.s, fin, p, true, false, mot);
        }
        // prénom seul
        if (p.prenom && p.prenom.length >= 3 && t.n === p.prenom && t.cap) {
          const suiv = i + 1 < mots.length ? mots[i + 1] : null;
          if (suiv && colles(t, suiv) && deNom(suiv)) continue;          // « Pieter Janssens » : un nom complet
          if (prev && colles(prev, t) && deNom(prev) && !formule(prev)) continue;
          noter(t.s, t.e, p, true, !!(prev && colles(prev, t) && formule(prev)), t.w);
        }
      }
    }
    const dejaTermes = new Set([...(termes || [])].map(x => String(x).toLowerCase().replace(/\s+/g, " ").trim()));
    const res = [];
    for (const g of groupes.values()) {
      if (dejaTermes.has(g.v.toLowerCase())) continue;
      const [personne] = g.personnes;
      // Jeton de la personne seulement sans ambiguïté : une seule personne, un nom
      // (pas une adresse e-mail), et le terme, qui se masquera PARTOUT, ne touche
      // rien d'autre que les occurrences comptées ici (pas « Kris Janssens »).
      let aliasDe = null;
      if (g.personnes.size === 1 && g.sources.has("nom") && g.sources.size === 1 && g.aliasOk) {
        const re = motifTerme(g.v);
        let total = 0, x;
        while (re && (x = re.exec(text))) { if (!couvert(x.index, x.index + x[0].length)) total++; if (x.index === re.lastIndex) re.lastIndex++; }
        if (total === g.n) aliasDe = personne;
      }
      res.push({ v: g.v, n: g.n, partie: true, de: g.sources.has("nom") ? personne : null, aliasDe });
    }
    return res.sort((a, b) => b.n - a.n).slice(0, 10);
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
    // Un texte recollé tel qu'on l'a copié commence par la consigne pour l'IA,
    // dont l'exemple est un vrai jeton : on la retire avant tout, sinon elle
    // compterait comme un remplacement (et afficherait la vraie valeur).
    const sansConsigne = retirerConsigne(src);
    const consigneRetiree = sansConsigne !== String(src);
    src = sansConsigne;
    const parNom = new Map();
    for (const [tok, val] of Object.entries(correspondances || {})) parNom.set(nomDeJeton(tok), { tok, val });
    // clés internes (anciens noms de jetons, tables exportées avant le changement)
    // et noms de jetons actuels
    const categories = new Set([...CATS.map(c => c.key), ...CATS.map(c => c.jeton), ...TYPES_TERME.map(t => t.jeton)]);
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
    return { texte, remplaces, variantes, inconnus: [...inconnus], absents, consigneRetiree };
  }

  /* ------------------------- consigne pour l'IA ---------------------------
     La ré-identification échoue quand l'IA réécrit les jetons ; un débutant ne
     sait pas quoi lui dire. L'outil fournit la phrase. Elle n'entre JAMAIS dans
     le fichier produit (PDF, Word) : seulement dans ce qu'on copie, le .txt, ou
     le presse-papiers à part. `exemple` : un jeton réellement présent. */
  const CONSIGNE_PSEUDO = (ex) => "Ce document est pseudonymisé. Les éléments entre crochets, comme " + ex +
    ", remplacent des données réelles : reprends-les tels quels dans ta réponse, sans les modifier ni chercher à les deviner.";
  const CONSIGNE_PAVES = "Ce document est anonymisé. Les passages noircis masquent des données réelles : " +
    "ne cherche pas à les deviner.";
  function consigneIA(mode, exemple) {
    if (mode === "redact") return CONSIGNE_PAVES;
    const ex = /^\[[A-Z][A-Z_]*_\d+\]$/.test(String(exemple || "")) ? exemple : "[PERSONNE_1]";
    return CONSIGNE_PSEUDO(ex);
  }
  /* Retire une consigne placée en tête (avec les blancs qui la suivent). La
     forme est reconnue, pas le texte exact : l'exemple change d'un document à
     l'autre, et un copier-coller peut ajouter des espaces. */
  const RE_CONSIGNE = /^\s*Ce document est (?:pseudonymisé\. Les éléments entre crochets, comme [^\n]{1,60}?, remplacent des données réelles : reprends-les tels quels dans ta réponse, sans les modifier ni chercher à les deviner\.|anonymisé\. Les passages noircis masquent des données réelles : ne cherche pas à les deviner\.)[ \t]*(?:\r?\n|$)\s*/u;
  function retirerConsigne(src) { return String(src).replace(RE_CONSIGNE, ""); }

  /* ------------------------------ profils métier ---------------------------
     Un profil = les écarts au réglage « Général » (défauts des catégories). Ils
     vivent ici, et non dans le balisage, pour être testés sous Node. L'adresse
     (?metier=…) retient le profil : aucun stockage dans le navigateur. */
  const PROFILS = [
    { id: "general", label: "Général", ecarts: {},
      phrase: "Tout ce qui identifie une personne est masqué. Les montants et les dates ordinaires restent en clair." },
    { id: "comptabilite", label: "Comptabilité / fiduciaire", ecarts: { REFERENCE: false },
      phrase: "Les numéros de facture, de pièce et de dossier restent aussi en clair : ils servent au travail." },
    { id: "rh", label: "RH / paie", ecarts: {},
      phrase: "Dates de période et montants en clair ; matricules, n° national et coordonnées masqués." },
    { id: "syndical", label: "Délégué·e syndical·e", ecarts: { DATE: true },
      phrase: "Les dates sont aussi masquées : la date d'un fait ou d'une audition aide à reconnaître un dossier." },
    { id: "sante", label: "Soins de santé", ecarts: { DATE: true },
      phrase: "Les dates sont aussi masquées : une date de soins peut suffire à reconnaître un patient." },
    { id: "veterinaire", label: "Vétérinaire", ecarts: {}, enAvant: ["PUCE"],
      phrase: "Les numéros de puce électronique sont masqués, comme les coordonnées du propriétaire." },
  ];
  function profil(id) { return PROFILS.find(p => p.id === id) || PROFILS[0]; }
  /* Réglage complet d'un profil : { CAT: bool } pour chaque catégorie. */
  function reglagesProfil(id) {
    const p = profil(id), r = {};
    for (const c of CATS) r[c.key] = c.defaut !== false;
    return Object.assign(r, p.ecarts);
  }
  /* Les cases cochées correspondent-elles exactement au profil ? */
  function memesReglages(actives, id) {
    const r = reglagesProfil(id);
    return CATS.every(c => (actives[c.key] !== false) === r[c.key]);
  }
  /* « ?metier=sante » → "sante" ; absent ou inconnu → "general", sans erreur. */
  function profilDepuisAdresse(recherche) {
    let v = null;
    try { v = new URLSearchParams(String(recherche || "")).get("metier"); } catch (e) { v = null; }
    return PROFILS.some(p => p.id === v) ? v : "general";
  }

  global.Regles = { CATS, EXCLUDE, cle, escapeRe, detect, dedup, completerOccurrences, extendAddresses,
                    analyser, creerTable, attribuerJetons, nomJeton, suggestionsDeNoms, suggestionsDeParties, reidentifier,
                    motifTerme, occurrencesTerme, TYPES_TERME, typeTerme, typeTermeParDefaut, creerTermes,
                    consigneIA, retirerConsigne, PROFILS, profil, reglagesProfil, memesReglages, profilDepuisAdresse,
                    valid: { luhn, validTel, validNiss, validBce, validIban, validCp, validReference,
                             validNaissance, validPuce } };
})(globalThis);
