/* ===========================================================================
   Récapitulatif d'anonymisation — partie PURE (aucun accès au DOM), testée sous
   Node (tests/regles.mjs, section K). Script classique : installe
   `globalThis.Recapitulatif`.

   Il décrit un TRAITEMENT (quoi, comment, combien), jamais son contenu : aucune
   valeur en clair, aucun jeton associé à une valeur, pas même le nom du fichier
   d'origine (« Devis pour Dupont.pdf » est déjà une fuite). Seul le nom du
   fichier PRODUIT y figure, et il est lui-même repassé au filtre : toute valeur
   interdite qui y subsisterait est remplacée par « [masqué] ».

   Ce n'est ni une attestation ni un certificat : l'outil est une aide, il ne
   garantit rien, et le texte le dit.
   =========================================================================== */
(function (global) {
  "use strict";

  const deux = (n) => String(n).padStart(2, "0");
  function dateLisible(d) {
    return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
  }
  const pl = (n, un, plusieurs) => n + " " + (n > 1 ? plusieurs : un);

  const ENTREES = { pdf: "PDF", "pdf-scanne": "PDF numérisé (texte reconnu par OCR)", image: "Image (texte reconnu par OCR)",
                    word: "Word (.docx)", texte: "Texte collé" };

  /* Remplace toute occurrence (casse et blancs ignorés) d'une valeur interdite. */
  function filtrer(texte, interdits) {
    let t = String(texte);
    const liste = [...new Set((interdits || []).map(v => String(v || "").trim()).filter(v => v.length >= 2))]
      .sort((a, b) => b.length - a.length);
    for (const v of liste) {
      const motif = v.split(/\s+/).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]+");
      try { t = t.replace(new RegExp(motif, "giu"), "[masqué]"); } catch (e) { /* motif inattendu */ }
    }
    return t;
  }

  /* infos :
       date (Date), nomProduit, entree ('pdf' | 'pdf-scanne' | 'image' | 'word' | 'texte'),
       mode ('pseudo' | 'redact'), profil (libellé, ou « personnalisé »), ia (bool),
       hits (détections ACTIVES : seuls `cat` et `token` servent, à compter),
       libelle (cat → libellé), nEcartees, nTermes,
       verification : { etat: 'verifie' | 'non-verifiable' | 'echec' | 'sans-objet' | 'en-attente',
                        nMentions, nAcceptees },
       avertissements (phrases génériques, sans valeur),
       interdits (valeurs détectées, termes ajoutés, nom d'origine : filet de sécurité) */
  function generer(infos) {
    const o = infos || {};
    const libelle = o.libelle || ((k) => k);
    // par catégorie : nombre de VALEURS distinctes (un jeton = une valeur)
    const parCat = new Map();
    for (const h of o.hits || []) {
      const s = parCat.get(h.cat) || new Set();
      s.add(h.token || h.cat + "#" + s.size);
      parCat.set(h.cat, s);
    }
    const totalValeurs = [...parCat.values()].reduce((a, s) => a + s.size, 0);
    const v = o.verification || { etat: "en-attente" };
    const verif = {
      "verifie": "vérifié — l'outil a relu le fichier produit et n'y a retrouvé aucune des valeurs masquées",
      "non-verifiable": "non vérifiable — la page est une image : aucune extraction de texte ne peut confirmer l'effacement",
      "echec": "échec — " + pl(v.nMentions || 0, "mention restait", "mentions restaient") + " dans le fichier produit",
      "sans-objet": "sans objet — texte collé, pas de fichier relu",
      "en-attente": "pas encore effectuée",
    }[v.etat] || "pas encore effectuée";

    const L = [];
    L.push("RÉCAPITULATIF D'ANONYMISATION");
    L.push("==============================");
    L.push("");
    L.push("Date et heure       : " + dateLisible(o.date instanceof Date ? o.date : new Date()));
    L.push("Fichier produit     : " + (o.nomProduit || "—"));
    L.push("Type d'entrée       : " + (ENTREES[o.entree] || "—"));
    L.push("Mode                : " + (o.mode === "redact" ? "pavés noirs (caviardage)" : "pseudonymes"));
    L.push("Profil métier       : " + (o.profil || "—"));
    L.push("Détection par IA    : " + (o.ia ? "activée" : "non activée"));
    L.push("");
    L.push("Valeurs masquées par catégorie (" + pl(totalValeurs, "valeur", "valeurs") + " au total) :");
    if (!parCat.size) L.push("  aucune");
    for (const [cat, s] of [...parCat.entries()].sort((a, b) => b[1].size - a[1].size))
      L.push("  - " + libelle(cat) + " : " + s.size);
    L.push("");
    L.push("Valeurs écartées par l'utilisateur  : " + (o.nEcartees || 0));
    L.push("Termes ajoutés à la main            : " + (o.nTermes || 0));
    L.push("");
    L.push("Vérification du fichier produit : " + verif);
    if (v.etat === "echec") L.push("Mentions acceptées malgré l'échec : " + (v.nAcceptees || 0));
    const av = (o.avertissements || []).filter(Boolean);
    if (av.length) {
      L.push("");
      L.push("Avertissements :");
      for (const a of av) L.push("  - " + a);
    }
    L.push("");
    L.push("Relecture humaine effectuée : ☐ oui");
    L.push("Nom : ______________________________   Date : ____ / ____ / ________");
    L.push("");
    L.push("Ce récapitulatif ne contient aucune donnée du document : seulement des nombres et des réglages.");
    L.push("Outil d'aide, pas une garantie : ce récapitulatif décrit un traitement, il ne certifie pas un résultat.");
    return filtrer(L.join("\n") + "\n", o.interdits);
  }

  global.Recapitulatif = { generer, filtrer };
})(globalThis);
