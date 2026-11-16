/* ===========================================================================
   Anonymisation d'un fichier Word (.docx) en CONSERVANT sa mise en page.

   Principe : on ne convertit pas le Word, on édite son XML. Un .docx est une
   archive zip ; le texte vit dans `word/document.xml` (et en-têtes, pieds de
   page, notes, commentaires…). On ne réécrit que le strict nécessaire : le XML
   est découpé en morceaux, seuls les morceaux de texte touchés sont
   ré-encodés, tout le reste est recopié tel quel. Aucune ré-sérialisation
   globale, donc aucun risque d'abîmer un espace de noms ou un attribut.

   Script classique (comme anon-geom.js) : installe `globalThis.AnonDocx`.
   Aucune dépendance au DOM (ni DOMParser) : tourne dans le navigateur ET dans
   Node. JSZip est pris sur `globalThis.JSZip` ou passé en option `{ JSZip }`.

   Voir tests/README.md, section « Word : les pièges », pour le pourquoi de
   chaque décision.
   =========================================================================== */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ XML */

  const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

  function decoder(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
      if (e[0] !== "#") return ENTITES[e];
      const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (_) { return m; }
    });
  }
  const encoderTexte = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function encoderAttr(s, q) {
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return q === "'" ? s.replace(/'/g, "&apos;") : s.replace(/"/g, "&quot;");
  }

  /* Un « jeton » XML : commentaire, CDATA, instruction, ou balise (les `>`
     dans un attribut entre guillemets ne la terminent pas). */
  const JETON_XML = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!?\/?[^\s>\/!?][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;

  /* Éléments porteurs de texte → type de flux. Un flux = le texte d'UN
     paragraphe pour UNE couche : on ne cherche jamais une valeur à cheval
     entre le texte visible, le texte supprimé en suivi des modifications et
     un code de champ. */
  const ELEMENTS_TEXTE = {
    "w:t": "t", "a:t": "t", "m:t": "t",
    "w:delText": "del",
    "w:instrText": "instr", "w:delInstrText": "instr",
    "c:v": "isole",                       // valeur en cache d'un graphique
  };
  /* Ces éléments honorent xml:space : sans lui, Word rogne les blancs en tête
     et en queue du texte réécrit. */
  const AVEC_PRESERVE = new Set(["w:t", "w:delText", "w:instrText", "w:delInstrText", "m:t"]);
  /* Éléments vides qui valent un caractère dans le texte lu. */
  const PSEUDOS = { "w:tab": "\t", "w:br": "\n", "w:cr": "\n", "w:noBreakHyphen": "-" };

  /* Découpe un XML en morceaux : des chaînes brutes, des segments de texte
     modifiables (`seg`) et des éléments vides à valeur de caractère (`pseudo`).
     serialiser(analyser(x)) === x tant que rien n'est modifié. */
  function analyser(xml) {
    const re = new RegExp(JETON_XML.source, "g");
    const m = { pieces: [], paragraphes: [], flux: [], nParagraphes: 0 };
    const pieces = m.pieces;
    const pile = [];                       // paragraphes ouverts : le plus intérieur en dernier
    let dansProps = 0;                     // dans w:pPr / w:tabs : les <w:tab> y sont des taquets, pas du texte
    let dernier = 0, r;

    const pousser = s => {
      if (!s) return;
      if (typeof pieces[pieces.length - 1] === "string") pieces[pieces.length - 1] += s;
      else pieces.push(s);
    };
    const nouveauFlux = (type) => { const f = { type, items: [], cache: null }; m.flux.push(f); return f; };
    const fluxDe = (para, type) => para.flux[type] || (para.flux[type] = nouveauFlux(type));

    while ((r = re.exec(xml))) {
      pousser(xml.slice(dernier, r.index));
      dernier = re.lastIndex;
      const balise = r[0];
      if (balise[1] === "!" || balise[1] === "?") { pousser(balise); continue; }
      const ferme = balise[1] === "/";
      const auto = balise.endsWith("/>");
      const nom = /^<\/?([^\s\/>]+)/.exec(balise)[1];

      if (nom === "w:p" || nom === "a:p") {
        if (ferme) pile.pop();
        else {
          const p = { flux: {} };
          m.paragraphes.push(p); m.nParagraphes++;
          if (!auto) pile.push(p);
        }
      } else if (nom === "w:pPr" || nom === "w:tabs") {
        if (ferme) dansProps--; else if (!auto) dansProps++;
      } else if (ELEMENTS_TEXTE[nom] && !ferme && !auto) {
        // Le contenu s'étend jusqu'à la balise suivante.
        let fin = xml.indexOf("<", dernier); if (fin < 0) fin = xml.length;
        const brut = xml.slice(dernier, fin);
        const seg = { t: "seg", nom, ouv: balise, brut, texte: decoder(brut), modif: false };
        re.lastIndex = dernier = fin;
        pieces.push(seg);
        const kind = ELEMENTS_TEXTE[nom];
        let para = pile[pile.length - 1];
        if (kind === "isole" || !para) {   // hors paragraphe : son propre flux
          para = { flux: {} }; m.paragraphes.push(para);
        }
        fluxDe(para, kind === "isole" ? "t" : kind).items.push(seg);
        continue;
      } else if (auto && PSEUDOS[nom] && !dansProps && pile.length) {
        const p = { t: "pseudo", brut: balise, car: PSEUDOS[nom], supprime: false };
        pieces.push(p);
        fluxDe(pile[pile.length - 1], "t").items.push(p);
        continue;
      }
      pousser(balise);
    }
    pousser(xml.slice(dernier));
    return m;
  }

  function serialiser(m) {
    let out = "";
    for (const p of m.pieces) {
      if (typeof p === "string") out += p;
      else if (p.t === "seg") out += p.ouv + (p.modif ? encoderTexte(p.texte) : p.brut);
      else if (!p.supprime) out += p.brut;
    }
    return out;
  }

  /* Texte d'un flux + table caractère → (élément, position dans l'élément). */
  function construire(flux) {
    if (flux.cache) return flux.cache;
    let s = "";
    const items = [], offs = [];
    for (const it of flux.items) {
      if (it.t === "seg") {
        for (let i = 0; i < it.texte.length; i++) { items.push(it); offs.push(i); }
        s += it.texte;
      } else if (!it.supprime) { items.push(it); offs.push(0); s += it.car; }
    }
    return (flux.cache = { s, items, offs });
  }

  function avecPreserve(ouv) {
    if (/\sxml:space\s*=/.test(ouv))
      return ouv.replace(/(\sxml:space\s*=\s*)(?:"[^"]*"|'[^']*')/, '$1"preserve"');
    return ouv.replace(/>$/, ' xml:space="preserve">');
  }

  /* ------------------------------------------------------------ valeurs */

  const echapperRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* Toute suite de blancs de la valeur (espace, insécable, fine insécable,
     tabulation, saut de ligne…) vaut une suite de blancs quelconque. */
  function souple(valeur) {
    return new RegExp(valeur.trim().split(/\s+/).map(echapperRe).join("\\s+"), "g");
  }
  const masque = n => "█".repeat(Math.max(3, Math.min(n, 12)));

  /* Valeurs triées de la plus longue à la plus courte : une valeur incluse
     dans une autre ne doit pas casser la plus longue. */
  function preparer(remplacements, mode) {
    const vus = new Set(), out = [];
    for (const r of remplacements || []) {
      if (!r || typeof r.valeur !== "string" || !r.valeur.trim() || vus.has(r.valeur)) continue;
      vus.add(r.valeur);
      const jeton = r.jeton || "[MASQUÉ]";
      const v = { valeur: r.valeur, re: souple(r.valeur),
                  repl: mode === "redact" ? masque(r.valeur.length) : jeton };
      // Valeur sur plusieurs lignes : peut être à cheval sur deux paragraphes ;
      // à défaut de la trouver d'un bloc, on remplace chaque ligne d'au moins 3 car.
      if (/[\r\n]/.test(r.valeur))
        v.segments = r.valeur.split(/\r\n|\r|\n/).map(s => s.trim()).filter(s => s.length >= 3)
          .map(s => ({ valeur: s, re: souple(s), repl: mode === "redact" ? masque(s.length) : jeton }));
      out.push(v);
    }
    return out.sort((a, b) => b.valeur.length - a.valeur.length);
  }

  /* La valeur (ou, si elle est sur plusieurs lignes, l'un de ses segments)
     figure-t-elle dans cette chaîne ? */
  function contient(v, str) {
    for (const c of [v, ...(v.segments || [])]) { c.re.lastIndex = 0; if (c.re.test(str)) return true; }
    return false;
  }

  /* Remplace dans une simple chaîne (attributs, nœuds texte hors paragraphe). */
  function remplacerChaine(str, v) {
    let n = 0;
    const brut = new RegExp(v.re.source, "g");
    str = str.replace(brut, () => { n++; return v.repl; });
    if (!n && v.segments)
      for (const s of v.segments)
        str = str.replace(new RegExp(s.re.source, "g"), () => { n++; return s.repl; });
    return { str, n };
  }

  /* Écrit `repl` à la place de [a, b) du flux construit `c`. Le remplacement
     va dans le PREMIER segment touché, la partie couverte est retirée des
     suivants (et les <w:tab/>, <w:br/>… couverts sont supprimés). */
  function poser(c, a, b, repl) {
    const parSeg = new Map();
    for (let k = a; k < b; k++) {
      const it = c.items[k];
      if (it.t !== "seg") continue;
      const r = parSeg.get(it);
      if (r) r.hi = c.offs[k] + 1; else parSeg.set(it, { lo: c.offs[k], hi: c.offs[k] + 1 });
    }
    if (!parSeg.size) return false;        // rien de textuel à porter le jeton
    for (let k = a; k < b; k++) if (c.items[k].t === "pseudo") c.items[k].supprime = true;
    let premier = true;
    for (const [seg, { lo, hi }] of parSeg) {
      seg.texte = seg.texte.slice(0, lo) + (premier ? repl : "") + seg.texte.slice(hi);
      seg.modif = true;
      if (AVEC_PRESERVE.has(seg.nom)) seg.ouv = avecPreserve(seg.ouv);
      premier = false;
    }
    return true;
  }

  /* Remplace `re` dans tous les flux ; renvoie le nombre d'occurrences. On
     applique de la dernière à la première : les positions restent valables. */
  function appliquer(m, re, repl) {
    let n = 0;
    for (const f of m.flux) {
      const c = construire(f);
      if (!c.s) continue;
      re.lastIndex = 0;
      const hits = []; let r;
      while ((r = re.exec(c.s))) {
        if (!r[0].length) { re.lastIndex++; continue; }
        hits.push([r.index, r.index + r[0].length]);
      }
      for (let h = hits.length - 1; h >= 0; h--) if (poser(c, hits[h][0], hits[h][1], repl)) n++;
      if (hits.length) f.cache = null;
    }
    return n;
  }

  function remplacerDansFlux(m, v) {
    let n = appliquer(m, v.re, v.repl);
    if (!n && v.segments) for (const s of v.segments) n += appliquer(m, s.re, s.repl);
    return n;
  }

  /* ------------------------------------------------------------ attributs */

  const ATTR = /(\s)([^\s=\/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;
  /* Attributs porteurs de texte, dans les parties word/ : on n'y touche que
     s'ils sont connus, pour ne jamais casser un id, un style ou une relation. */
  const ATTR_TEXTE = new Set(["descr", "title", "tooltip", "w:tooltip", "w:instr", "w:displayText",
                              "w:docLocation", "w:fldData"]);

  function attributAEditer(tag, attr) {
    if (ATTR_TEXTE.has(attr)) return true;
    if (attr === "name" && /(^|:)(docPr|cNvPr)$/.test(tag)) return true;     // nom d'image = nom de fichier
    if (tag === "w:docVar") return attr === "w:name" || attr === "w:val";
    if (tag === "w:alias" || tag === "w:tag") return attr === "w:val";       // contrôles de contenu
    return false;
  }

  /* Réécrit les attributs de chaque balise. Mode « word » : auteurs et
     initiales vidés systématiquement, valeurs remplacées dans les attributs
     connus. Mode « tout » : valeurs remplacées dans tous les attributs. */
  function traiterAttributs(xml, vals, modeWord) {
    let n = 0, auteurs = 0;
    const re = new RegExp(JETON_XML.source, "g");
    const out = xml.replace(re, balise => {
      if (balise[1] === "!" || balise[1] === "?" || balise[1] === "/") return balise;
      const tag = /^<([^\s\/>]+)/.exec(balise)[1];
      return balise.replace(ATTR, (tout, esp, nom, eg, v1, v2) => {
        const q = v1 !== undefined ? '"' : "'";
        const brut = v1 !== undefined ? v1 : v2;
        if (modeWord) {
          const loc = nom.replace(/^.*:/, "");
          if (loc === "author" || loc === "initials") {
            if (brut === "Auteur") return tout;
            auteurs++; return esp + nom + eg + q + "Auteur" + q;
          }
          // people.xml : identifiant de compte, parfois une adresse e-mail
          if (tag === "w15:presenceInfo" && loc === "userId" && brut !== "Auteur") {
            auteurs++; return esp + nom + eg + q + "Auteur" + q;
          }
          if (tag === "w15:presenceInfo" && loc === "providerId" && brut !== "None") {
            return esp + nom + eg + q + "None" + q;
          }
          if (!attributAEditer(tag, nom)) return tout;
        }
        let s = decoder(brut), change = false;
        for (const v of vals) { const r = remplacerChaine(s, v); if (r.n) { s = r.str; n += r.n; change = true; } }
        return change ? esp + nom + eg + q + encoderAttr(s, q) + q : tout;
      });
    });
    return { xml: out, n, auteurs };
  }

  /* Texte hors paragraphe d'une partie quelconque (customXml, docProps) :
     chaque nœud texte et chaque attribut est traité isolément. */
  function remplacerNoeuds(xml, vals) {
    let n = 0;
    const re = new RegExp(JETON_XML.source, "g");
    let out = "", dernier = 0, r;
    const sur = txt => {
      if (!txt.trim()) return txt;
      let s = decoder(txt), change = false;
      for (const v of vals) { const x = remplacerChaine(s, v); if (x.n) { s = x.str; n += x.n; change = true; } }
      return change ? encoderTexte(s) : txt;
    };
    while ((r = re.exec(xml))) {
      out += sur(xml.slice(dernier, r.index)) + r[0];
      dernier = re.lastIndex;
    }
    out += sur(xml.slice(dernier));
    const a = traiterAttributs(out, vals, false);
    return { xml: a.xml, n: n + a.n };
  }

  /* ------------------------------------------------- relations, métadonnées */

  /* Cibles de liens (`mailto:sophie@…`) : une adresse disparue du texte
     survivrait ici. Seules les cibles EXTERNES sont neutralisées : une cible
     interne (image, en-tête) est un chemin dans l'archive, la changer
     casserait le fichier. */
  function traiterRels(xml, vals) {
    let n = 0;
    const out = xml.replace(/<Relationship\b[^>]*>/g, tag => {
      if (!/TargetMode\s*=\s*["']External["']/.test(tag)) return tag;
      return tag.replace(/(\sTarget\s*=\s*)(?:"([^"]*)"|'([^']*)')/, (t, pre, a, b) => {
        const dec = decoder(a !== undefined ? a : b);
        const cand = [dec];
        try { cand.push(decodeURIComponent(dec)); } catch (_) { /* % isolé */ }
        try { cand.push(decodeURIComponent(dec.replace(/\+/g, " "))); } catch (_) { /* idem */ }
        if (cand.some(c => vals.some(v => contient(v, c)))) { n++; return pre + '"about:blank"'; }
        return t;
      });
    });
    return { xml: out, n };
  }

  /* La vignette est une image de la première page, en clair : on retire sa
     relation (sinon Word signale un fichier corrompu). */
  function retirerRelVignette(xml) {
    let retiree = false;
    const out = xml.replace(/<Relationship\b[^>]*>/g, tag => {
      if (/docProps\/thumbnail\.|\/thumbnail["']/i.test(tag)) { retiree = true; return ""; }
      return tag;
    });
    return { xml: out, retiree };
  }

  function viderChamps(xml, noms) {
    let n = 0;
    const re = new RegExp("<(" + noms.join("|") + ")(\\s[^>]*)?>([\\s\\S]*?)</\\1>", "g");
    const out = xml.replace(re, (t, nom, attrs, contenu) => {
      if (!contenu.trim()) return t;
      n++; return `<${nom}${attrs || ""}></${nom}>`;
    });
    return { xml: out, n };
  }

  /* Comme nettoyerMetadonnees pour les PDF : on vide, qu'une valeur soit
     détectée ou non — un auteur n'est presque jamais dans le texte. */
  function nettoyerMeta(nom, xml) {
    if (nom === "docProps/core.xml")
      return viderChamps(xml, ["dc:creator", "cp:lastModifiedBy", "dc:title", "dc:subject",
                               "cp:keywords", "dc:description", "cp:category"]);
    if (nom === "docProps/app.xml") return viderChamps(xml, ["Company", "Manager", "HyperlinkBase"]);
    if (nom === "docProps/custom.xml") return viderChamps(xml, ["vt:lpwstr", "vt:lpstr", "vt:bstr"]);
    return { xml, n: 0 };
  }

  /* ----------------------------------------------------------- archive */

  function jszip(opts) {
    const J = (opts && opts.JSZip) || global.JSZip;
    if (!J) throw new Error("JSZip introuvable : charger vendor/jszip.min.js ou passer { JSZip }.");
    return J;
  }
  const DEC = new TextDecoder("utf-8", { ignoreBOM: true });   // garde le BOM : aller-retour exact
  const ENC = new TextEncoder();

  /* Rôle d'une entrée du zip dans l'anonymisation. */
  function classer(nom) {
    if (/^docProps\/thumbnail\./i.test(nom)) return "vignette";
    if (/\.rels$/i.test(nom)) return "rels";
    if (/^word\/.+\.xml$/i.test(nom)) return "word";
    if (/^docProps\/.+\.xml$/i.test(nom) || /^customXml\/.+\.xml$/i.test(nom)) return "noeuds";
    if (/^word\/embeddings\//i.test(nom)) return "incorpore";
    if (/^word\/media\//i.test(nom)) return "image";
    return null;
  }
  const estXml = nom => /\.(xml|rels)$/i.test(nom);
  const pluriel = (n, s, p) => n + " " + (n > 1 ? p : s);

  async function anonymiser(octets, remplacements, opts = {}) {
    const JSZip = jszip(opts);
    const mode = opts.mode === "redact" ? "redact" : "pseudo";
    const vals = preparer(remplacements, mode);
    const zip = await JSZip.loadAsync(octets);
    const noms = Object.keys(zip.files).filter(n => !zip.files[n].dir);

    const rapport = { nRemplacements: 0, parPartie: {}, metaNettoyees: 0, liensNeutralises: 0,
                      vignetteRetiree: false, auteursNeutralises: 0, avertissements: [] };
    let nImages = 0, nObjets = 0;

    const ecrire = (nom, xml) =>
      zip.file(nom, ENC.encode(xml), { binary: true, date: zip.files[nom].date, createFolders: false });
    const compter = (nom, n) => { if (n) { rapport.nRemplacements += n; rapport.parPartie[nom] = (rapport.parPartie[nom] || 0) + n; } };

    for (const nom of noms) {
      const role = classer(nom);
      if (role === "vignette") { zip.remove(nom); rapport.vignetteRetiree = true; continue; }
      if (role === "image") { nImages++; continue; }
      if (role === "incorpore") { nObjets++; continue; }
      if (!role) continue;

      const source = DEC.decode(await zip.files[nom].async("uint8array"));
      let xml = source;

      if (role === "rels") {
        const r = traiterRels(xml, vals);
        xml = r.xml; rapport.liensNeutralises += r.n;
        if (nom === "_rels/.rels") {
          const t = retirerRelVignette(xml);
          xml = t.xml; if (t.retiree) rapport.vignetteRetiree = true;
        }
      } else if (role === "word") {
        const m = analyser(xml);
        let n = 0;
        for (const v of vals) n += remplacerDansFlux(m, v);
        const a = traiterAttributs(serialiser(m), vals, true);
        xml = a.xml; n += a.n;
        rapport.auteursNeutralises += a.auteurs;
        compter(nom, n);
      } else {                              // docProps/*, customXml/*
        const meta = nettoyerMeta(nom, xml);
        xml = meta.xml; rapport.metaNettoyees += meta.n;
        const r = remplacerNoeuds(xml, vals);
        xml = r.xml; compter(nom, r.n);
      }
      if (xml !== source) ecrire(nom, xml);
    }

    if (nImages) rapport.avertissements.push(`${pluriel(nImages, "image", "images")} : leur contenu n'est pas analysé`);
    if (nObjets) rapport.avertissements.push(`${pluriel(nObjets, "objet incorporé non analysé", "objets incorporés non analysés")}`);

    rapport.octets = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE",
                                               compressionOptions: { level: 6 } });
    return rapport;
  }

  /* ------------------------------------------------------- lecture du texte */

  const texteDe = f => construire(f).s;

  /* Lignes lisibles d'une partie : un paragraphe par ligne, texte supprimé en
     suivi des modifications compris (il reste dans le fichier : le détecteur
     doit le voir). Les codes de champ n'y sont pas : ce n'est pas du texte. */
  function lignesDe(m) {
    const out = [];
    for (const p of m.paragraphes) {
      const t = p.flux.t ? texteDe(p.flux.t) : "";
      if (t.trim()) out.push(t);
      const d = p.flux.del ? texteDe(p.flux.del) : "";
      if (d.trim()) out.push(d);
    }
    return out;
  }

  function rang(nom) {
    if (/^word\/document\.xml$/i.test(nom)) return 0;
    if (/^word\/header/i.test(nom)) return 1;
    if (/^word\/footer/i.test(nom)) return 2;
    if (/^word\/footnotes/i.test(nom)) return 3;
    if (/^word\/endnotes/i.test(nom)) return 4;
    if (/^word\/comments/i.test(nom)) return 5;
    return 6;
  }
  const naturel = (a, b) => a.localeCompare(b, "en", { numeric: true });

  async function extraireTexte(octets, opts = {}) {
    const zip = await jszip(opts).loadAsync(octets);
    const noms = Object.keys(zip.files).filter(n => !zip.files[n].dir && classer(n) === "word")
      .sort((a, b) => rang(a) - rang(b) || naturel(a, b));
    const parties = [];
    for (const nom of noms) {
      const m = analyser(DEC.decode(await zip.files[nom].async("uint8array")));
      const texte = lignesDe(m).join("\n");
      if (texte.trim()) parties.push({ nom, texte });
    }
    return { texte: parties.map(p => p.texte).join("\n\n"), parties };
  }

  /* ----------------------------------------------------------- vérification */

  function zoneDe(nom) {
    if (/^word\/document\.xml$/i.test(nom)) return "corps du document";
    if (/^word\/header/i.test(nom)) return "en-tête";
    if (/^word\/footer/i.test(nom)) return "pied de page";
    if (/^word\/footnotes/i.test(nom)) return "note de bas de page";
    if (/^word\/endnotes/i.test(nom)) return "note de fin";
    if (/^word\/comments/i.test(nom)) return "commentaire";
    if (/^word\/people\.xml$/i.test(nom)) return "liste des auteurs";
    if (/^word\/embeddings\//i.test(nom)) return "objet incorporé";
    if (/^word\/media\//i.test(nom)) return "image";
    if (/^word\/(charts|diagrams)\//i.test(nom)) return "graphique ou schéma";
    if (/^docProps\/thumbnail\./i.test(nom)) return "vignette";
    if (/^docProps\//i.test(nom)) return "métadonnées";
    if (/^customXml\//i.test(nom)) return "données XML personnalisées";
    if (/\.rels$/i.test(nom)) return "lien (cible d'une relation)";
    return `partie « ${nom} »`;
  }

  /* Nature de l'endroit où une valeur a été trouvée dans le XML brut. */
  function contexteXml(xml, pos, zone) {
    const lt = xml.lastIndexOf("<", pos), gt = xml.lastIndexOf(">", pos);
    if (lt > gt) return /^(lien|métadonnées)/.test(zone) ? zone : zone + " (attribut : texte alternatif, infobulle, auteur…)";
    const nom = /^<([^\s\/>]+)/.exec(xml.slice(lt, lt + 80));
    if (nom && nom[1] === "w:delText") return zone + " (texte supprimé en suivi des modifications)";
    if (nom && /^w:(del)?instrText$/.test(nom[1])) return zone + " (code de champ)";
    return zone;
  }

  function enLatin1(octets) {
    let s = "";
    for (let i = 0; i < octets.length; i += 32768)
      s += String.fromCharCode.apply(null, octets.subarray(i, i + 32768));
    return s;
  }
  /* Une valeur vue comme octets : UTF-8, puis UTF-16LE (Word incorpore des
     objets Office dont le texte est en UTF-16). */
  function aiguilles(texte) {
    const u16 = new Uint8Array(texte.length * 2);
    for (let i = 0; i < texte.length; i++) { u16[2 * i] = texte.charCodeAt(i) & 255; u16[2 * i + 1] = texte.charCodeAt(i) >> 8; }
    return [enLatin1(ENC.encode(texte)), enLatin1(u16)];
  }

  async function verifier(octets, valeurs, opts = {}) {
    const zip = await jszip(opts).loadAsync(octets);
    const noms = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    const uniques = [...new Set(valeurs)];
    // Même seuil que la vérification PDF : en dessous de 3 caractères, rien de concluant.
    const vals = uniques.filter(v => v && v.length >= 3).map(v => {
      const [c] = preparer([{ valeur: v, jeton: "" }], "pseudo");
      // Variante telle qu'écrite dans le XML (« Dupont &amp; Fils »).
      c.xml = souple(encoderAttr(v, '"'));
      c.res = (c.segments || []).map(s => ({ ...s, xml: souple(encoderAttr(s.valeur, '"')) }));
      c.aig = [v, ...(c.segments || []).map(s => s.valeur)].flatMap(aiguilles);
      return { c, lieux: new Set(), visible: false, octets: false };
    });

    for (const nom of noms) {
      const zone = zoneDe(nom);
      const brut = await zip.files[nom].async("uint8array");
      const xmlTexte = estXml(nom) ? DEC.decode(brut) : null;
      const m = classer(nom) === "word" ? analyser(xmlTexte) : null;
      const bin = xmlTexte === null ? enLatin1(brut) : null;
      for (const x of vals) {
        const { c } = x;
        if (contient(c, nom)) { x.octets = true; x.lieux.add("nom d'une entrée de l'archive"); }
        if (m) for (const f of m.flux) {
          if (!contient(c, texteDe(f))) continue;
          if (f.type === "t") { x.visible = true; x.lieux.add(zone); }
          else x.lieux.add(zone + (f.type === "del" ? " (texte supprimé en suivi des modifications)" : " (code de champ)"));
        }
        if (xmlTexte !== null) {
          for (const re of [c.re, c.xml, ...(c.segments || []).map(s => s.re), ...c.res.map(s => s.xml)]) {
            re.lastIndex = 0;
            const r = re.exec(xmlTexte);
            if (r) { x.octets = true; x.lieux.add(contexteXml(xmlTexte, r.index, zone)); }
          }
        } else if (c.aig.some(a => a && bin.includes(a))) { x.octets = true; x.lieux.add(zone); }
      }
    }

    const fuites = [], details = [];
    for (const { c, lieux, visible, octets: dansOctets } of vals) {
      if (!visible && !dansOctets) continue;
      fuites.push(c.valeur);
      details.push({ valeur: c.valeur, pages: [], dansOctets, visible,
                     objet: lieux.size ? [...lieux].join(" ; ") : null });
    }
    return { fuites, details, nVerifiees: new Set(valeurs).size };
  }

  global.AnonDocx = { extraireTexte, anonymiser, verifier,
                      _interne: { analyser, serialiser, souple, decoder, encoderTexte } };
})(globalThis);
