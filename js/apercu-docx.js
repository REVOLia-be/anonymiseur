/* ===========================================================================
   Aperçu d'un fichier Word (.docx) dans l'atelier : le document à l'écran, une
   « page » à la fois, avec le MÊME index texte ↔ positions qu'un PDF.

   Principe
   ────────
   1. docx-preview rend le .docx dans un conteneur HORS ÉCRAN mais réellement mis
      en page, à l'intérieur d'un Shadow DOM (les styles de la page ne touchent
      pas le document, ceux du document ne fuient pas dans la page).
   2. On parcourt les nœuds texte du rendu et on relève UN rectangle par
      caractère (Range). On en tire un index de la forme de `pdfIndex`
      (`{ texte, pages:[{texte, quads, origines, tailles, couleurs, sauts,
      largeur, hauteur}], bornes, nPages }`), en pixels CSS du rendu à l'échelle 1.
      Tout l'aval (zones, gestes, rail, AnonGeom) fonctionne alors sans changement.
   3. Les « pages » sont VIRTUELLES : docx-preview ne pagine que sur les sauts
      explicites. Une section plus haute qu'une page est découpée en tranches,
      les coupes tombant ENTRE deux lignes (jamais au milieu d'une ligne ou d'une
      rangée de tableau quand c'est évitable).
   4. Une page s'affiche en clonant la section rendue dans un Shadow DOM, mise à
      l'échelle par `transform: scale()`, non interactive : les zones sont
      posées par-dessus, en pourcentage, par le visualiseur.

   Script classique : installe `globalThis.ApercuDocx`. Dépend du DOM, de
   `globalThis.docxPreview` (docx-preview) et de `globalThis.JSZip`.
   Voir tests/README.md, section « Word : l'aperçu », pour le pourquoi.
   =========================================================================== */
(function (global) {
  "use strict";

  const OPTIONS_RENDU = {
    inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
    experimental: true, renderHeaders: true, renderFooters: true, renderFootnotes: true,
    useBase64URL: true,
  };
  const A4 = { largeur: 793.7, hauteur: 1122.5 };
  const TOLERANCE = 1.15;      // une section jusqu'à 1,15 page reste UNE page (police de remplacement)
  const BLOCS = "p,h1,h2,h3,h4,h5,h6,li,td,th,div,blockquote,article,header,footer,ol,ul,table";

  /* Isolation : on repart de zéro dans le Shadow DOM, et on retire ce que la
     bibliothèque met autour des feuilles (fond gris, ombre, marges) : seule la
     feuille nous intéresse. */
  const CSS_BASE =
    ":host{all:initial;display:block}" +
    ".docx-wrapper{background:none!important;padding:0!important;display:block!important}" +
    ".docx-wrapper>section.docx{box-shadow:none!important;margin:0!important}";

  const attendre = () => new Promise(r => setTimeout(r, 0));
  const px = (v, defaut) => { const n = parseFloat(v); return isFinite(n) ? n : defaut; };

  function annule() { const e = new Error("annulé"); e.annule = true; return e; }

  /* ---------------------------------------------------------------- rendu */

  function bibliotheque() {
    const lib = global.docxPreview;
    if (!lib || typeof lib.renderAsync !== "function")
      throw new Error("le moteur d'aperçu Word (docx-preview) n'est pas chargé");
    return lib;
  }

  /* Les @font-face déclarés DANS un Shadow DOM ne s'appliquent pas (limite des
     navigateurs) : on les recopie dans la page, où ils valent aussi pour les
     arbres fantômes. Rare (polices incorporées au document). */
  function recopierPolices(styles, vue) {
    let texte = "";
    for (const s of styles) {
      const m = s.textContent.match(/@font-face\s*\{[^}]*\}/g);
      if (m) texte += m.join("\n");
    }
    if (!texte) return;
    const st = document.createElement("style");
    st.setAttribute("data-apercu-docx", "polices");
    st.textContent = texte;
    document.head.appendChild(st);
    vue.stylePolices = st;
  }

  /* Rend le .docx dans un conteneur hors écran et renvoie {hote, conteneur,
     sections, styles}. */
  async function rendre(octets, actif) {
    const lib = bibliotheque();
    const hote = document.createElement("div");
    hote.setAttribute("aria-hidden", "true");
    // Réellement mis en page (pas display:none), mais invisible et hors du flux.
    hote.style.cssText = "position:absolute;left:-100000px;top:0;width:max-content;" +
                         "visibility:hidden;pointer-events:none";
    document.body.appendChild(hote);
    try {
      const racine = hote.attachShadow({ mode: "open" });
      const st = document.createElement("style"); st.textContent = CSS_BASE; racine.appendChild(st);
      const conteneur = document.createElement("div");
      racine.appendChild(conteneur);
      await lib.renderAsync(octets, conteneur, null, OPTIONS_RENDU);
      if (actif && !actif()) throw annule();
      const sections = [...conteneur.querySelectorAll("section.docx")];
      if (!sections.length) throw new Error("le document ne contient aucune page affichable");
      // images et polices : la hauteur des lignes en dépend
      const imgs = [...conteneur.querySelectorAll("img")].filter(i => !i.complete);
      await Promise.race([Promise.all(imgs.map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 1500))]);
      try { await document.fonts.ready; } catch (_) { /* ignoré */ }
      if (actif && !actif()) throw annule();
      const styles = [...conteneur.querySelectorAll("style")];
      return { hote, conteneur, sections, styles };
    } catch (e) {
      hote.remove();
      throw e;
    }
  }

  /* --------------------------------------------------------- pagination */

  /* Intervalles verticaux « occupés » d'une section (coordonnées relatives à son
     bord haut) : lignes de texte (un rectangle par ligne, légèrement rognés pour
     que deux lignes serrées ne fusionnent pas), images, et rangées de tableau
     que l'on évite de couper. Les creux entre intervalles fusionnés sont les
     seuls endroits où une coupe est acceptable. */
  function trousDe(sec, noeudsTexte, hautSec, hautContenu) {
    const iv = [];
    const rg = document.createRange();
    for (const n of noeudsTexte) {
      if (!n.data.trim()) continue;
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) {
        if (r.height <= 0) continue;
        const marge = r.height * 0.15;
        iv.push([r.top - hautSec + marge, r.bottom - hautSec - marge]);
      }
    }
    for (const e of sec.querySelectorAll("img,svg,canvas")) {
      const r = e.getBoundingClientRect();
      if (r.height > 0) iv.push([r.top - hautSec, r.bottom - hautSec]);
    }
    for (const tr of sec.querySelectorAll("tr")) {
      const r = tr.getBoundingClientRect();
      if (r.height > 0 && r.height <= hautContenu) iv.push([r.top - hautSec, r.bottom - hautSec]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    const trous = [];
    let fin = -Infinity;
    for (const [a, b] of iv) {
      if (fin > -Infinity && a > fin) trous.push((fin + a) / 2);
      if (b > fin) fin = b;
    }
    return trous;
  }

  /* Ordonnées de début de chaque tranche (la première vaut 0). Une page
     virtuelle commence sous une marge haute `mH` (sauf la première, qui a déjà la
     sienne dans la section) et la dernière ligne doit finir avant la marge basse
     `mB`. */
  function planifier(hauteur, H, mH, mB, trous) {
    const debuts = [0];
    if (hauteur <= H * TOLERANCE) return debuts;
    for (;;) {
      const c = debuts[debuts.length - 1];
      const premiere = debuts.length === 1;
      const cap = premiere ? H : H - mH;
      if (hauteur - c <= cap) break;
      const capCoupe = cap - mB, cible = c + capCoupe;
      let coupe = -1;
      for (let i = trous.length - 1; i >= 0; i--)
        if (trous[i] <= cible) { if (trous[i] > c + 0.3 * capCoupe) coupe = trous[i]; break; }
      if (coupe < 0) coupe = cible;               // rien de mieux : une ligne géante ou une image
      debuts.push(coupe);
      if (debuts.length > 5000) break;
    }
    return debuts;
  }

  function geometrieSection(sec) {
    const cs = getComputedStyle(sec);
    const r = sec.getBoundingClientRect();
    const hMin = /pt\s*$/.test(sec.style.minHeight) ? px(sec.style.minHeight) * 96 / 72 : px(sec.style.minHeight, 0);
    const wMin = /pt\s*$/.test(sec.style.width) ? px(sec.style.width) * 96 / 72 : px(sec.style.width, 0);
    const clamp = (v) => Math.max(24, Math.min(150, v));
    return {
      rect: r,
      L: Math.round((wMin || r.width || A4.largeur) * 10) / 10,
      H: Math.round((hMin || A4.hauteur) * 10) / 10,
      hauteur: r.height,
      mH: clamp(px(cs.paddingTop, 96)), mB: clamp(px(cs.paddingBottom, 96)),
    };
  }

  /* Pages (virtuelles) d'un rendu : [{section, tranche, nTranches, debut, fin,
     decalage, largeur, hauteur}], plus les nœuds texte de chaque section. */
  function paginer(rendu) {
    const pages = [], parSection = [];
    rendu.sections.forEach((sec, si) => {
      const g = geometrieSection(sec);
      const noeuds = listerTexte(sec).filter(x => x.t).map(x => x.t);
      const trous = trousDe(sec, noeuds, g.rect.top, g.H - g.mH - g.mB);
      const debuts = planifier(g.hauteur, g.H, g.mH, g.mB, trous);
      const n = debuts.length;
      const mesures = [];
      for (let k = 0; k < n; k++) {
        const unique = n === 1;
        const p = {
          section: si, tranche: k, nTranches: n,
          debut: debuts[k], fin: k < n - 1 ? debuts[k + 1] : g.hauteur,
          decalage: k === 0 ? 0 : g.mH,
          largeur: g.L, hauteur: unique ? Math.max(g.H, Math.round(g.hauteur)) : g.H,
        };
        pages.push(p); mesures.push(p);
      }
      parSection.push({ sec, g, debuts, noeuds, pages: mesures });
    });
    return { pages, parSection };
  }

  /* ----------------------------------------------------- parcours du texte */

  /* Nœuds texte d'une section, dans l'ordre du document, et sauts de ligne
     explicites (<br>). Ni <style> ni <script>. */
  function listerTexte(sec) {
    const out = [];
    const w = document.createTreeWalker(sec, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1 && (n.tagName === "STYLE" || n.tagName === "SCRIPT")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (n.data.length) out.push({ t: n, bloc: n.parentElement && n.parentElement.closest(BLOCS) }); }
      else if (n.tagName === "BR") out.push({ br: true });
    }
    return out;
  }

  /* ----------------------------------------------------------- l'index */

  async function construireIndex(rendu, pag, opts) {
    const { actif, progres } = opts;
    const rg = document.createRange();
    const taillePolice = new Map();
    const taille = (el) => {
      let v = taillePolice.get(el);
      if (v === undefined) { v = px(getComputedStyle(el).fontSize, 16); taillePolice.set(el, v); }
      return v;
    };
    // un « sac » par page virtuelle : les caractères y arrivent dans l'ordre du DOM
    const sacs = pag.pages.map(() => ({ car: [] }));
    const total = pag.parSection.reduce((s, x) => s + x.noeuds.reduce((a, n) => a + n.data.length, 0), 0) || 1;
    let fait = 0, t0 = performance.now();

    for (let si = 0; si < pag.parSection.length; si++) {
      const { sec, g, debuts, pages } = pag.parSection[si];
      const base = pag.pages.indexOf(pages[0]);
      const gauche = g.rect.left, haut = g.rect.top;
      const tranche = (yc) => {                         // dernière tranche dont le début ≤ yc
        let k = 0;
        for (let i = debuts.length - 1; i > 0; i--) if (debuts[i] <= yc) { k = i; break; }
        return k;
      };
      let dernier = 0;                                   // tranche du dernier caractère posé
      for (const x of listerTexte(sec)) {
        if (x.br) { sacs[base + dernier].car.push({ synth: "\n" }); continue; }
        const n = x.t, s = n.data, fs = taille(n.parentElement);
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c === 10 || c === 13) {                    // saut de ligne dans le texte lui-même
            sacs[base + dernier].car.push({ synth: "\n", bloc: x.bloc }); continue;
          }
          const paire = c >= 0xD800 && c < 0xDC00 && i + 1 < s.length;
          rg.setStart(n, i); rg.setEnd(n, i + (paire ? 2 : 1));
          const r = rg.getBoundingClientRect();
          let k = dernier, q = null;
          if (r.width > 0 && r.height > 0) {
            k = tranche((r.top + r.bottom) / 2 - haut);
            const dy = debuts[k] - pages[k].decalage;
            q = [r.left - gauche, r.top - haut - dy, r.right - gauche, r.bottom - haut - dy];
          }
          dernier = k;
          const ch = { u: s[i], q, bloc: x.bloc, fs, ox: q && q[0], oy: q && q[3] };
          sacs[base + k].car.push(ch);
          if (paire) { i++; sacs[base + k].car.push({ u: s[i], q, bloc: x.bloc, fs, ox: q && q[0], oy: q && q[3] }); }
        }
        fait += s.length;
        if (performance.now() - t0 > 25) {                // rendre la main à l'interface
          if (progres) progres(Math.min(1, fait / total));
          await attendre();
          if (actif && !actif()) throw annule();
          t0 = performance.now();
        }
      }
    }

    // assemblage : un saut de ligne SYNTHÉTIQUE entre deux blocs (paragraphes,
    // cellules, en-tête/corps/pied), jamais aux retours à la ligne automatiques.
    const index = { texte: "", pages: [], bornes: [], nPages: pag.pages.length, docx: true };
    sacs.forEach((sac, p) => {
      const meta = pag.pages[p];
      const lst = [];
      let bloc = null;
      for (const c of sac.car) {
        if (c.synth) { lst.push({ u: "\n", saut: 1 }); if (c.bloc) bloc = c.bloc; continue; }
        if (bloc && c.bloc && c.bloc !== bloc) lst.push({ u: "\n", saut: 1 });
        if (c.bloc) bloc = c.bloc;
        lst.push(c);
      }
      const N = lst.length;
      const quads = new Float32Array(N * 8), origines = new Float32Array(N * 2), tailles = new Float32Array(N),
            couleurs = new Float32Array(N * 3), sauts = new Uint8Array(N);
      let texte = "";
      lst.forEach((c, i) => {
        texte += c.u;
        if (c.saut) { sauts[i] = 1; return; }
        tailles[i] = c.fs || 0;
        if (c.q) {
          const [a, b, d, e] = c.q;
          quads.set([a, b, d, b, a, e, d, e], i * 8);
          origines[i * 2] = a; origines[i * 2 + 1] = e;
        }
      });
      const debut = index.texte.length;
      index.texte += texte;
      index.bornes.push({ debut, fin: index.texte.length });
      if (p < sacs.length - 1) index.texte += "\n\n";
      index.pages.push({ texte, quads, origines, tailles, couleurs, sauts,
                         largeur: meta.largeur, hauteur: meta.hauteur,
                         section: meta.section, tranche: meta.tranche,
                         fenetre: { debut: meta.debut, fin: meta.fin, decalage: meta.decalage } });
    });
    return index;
  }

  /* ------------------------------------------------------------ une vue */

  /* Une « vue » : un document rendu + son plan de pages. Sait monter une page
     dans un cadre de la scène, et se libérer. */
  function creerVue(rendu, pag) {
    const vue = {
      rendu, pages: pag.pages, nPages: pag.pages.length,
      nSections: rendu.sections.length, stylePolices: null, feuilleStyle: null, fermee: false,
    };
    // feuille de style partagée par toutes les pages montées (évite de recopier
    // le CSS du document à chaque affichage)
    const texteCss = CSS_BASE + "\n" + rendu.styles.map(s => s.textContent).join("\n");
    try { const f = new CSSStyleSheet(); f.replaceSync(texteCss); vue.feuilleStyle = f; }
    catch (_) { vue.texteCss = texteCss; }
    recopierPolices(rendu.styles, vue);

    vue.dims = (p) => { const m = vue.pages[p]; return m ? { largeur: m.largeur, hauteur: m.hauteur } : null; };

    /* Insère dans `cadre` un clone de la page `p`, mis à l'échelle pour tenir
       dans `largeur` pixels. Non interactif, non sélectionnable. */
    vue.monter = (cadre, p, largeur) => {
      const m = vue.pages[p];
      if (!m || vue.fermee) return null;
      const sec = rendu.sections[m.section];
      const hote = document.createElement("div");
      hote.className = "apercu-docx";
      hote.setAttribute("aria-hidden", "true");
      hote.style.cssText = "position:absolute;left:0;top:0;width:" + m.largeur + "px;height:" + m.hauteur + "px;" +
        "overflow:hidden;transform-origin:0 0;transform:scale(" + (largeur / m.largeur) + ");" +
        "pointer-events:none;user-select:none;-webkit-user-select:none";
      const racine = hote.attachShadow({ mode: "open" });
      if (vue.feuilleStyle) racine.adoptedStyleSheets = [vue.feuilleStyle];
      else { const st = document.createElement("style"); st.textContent = vue.texteCss; racine.appendChild(st); }
      const enveloppe = document.createElement("div");
      enveloppe.className = "docx-wrapper";
      const fenetre = document.createElement("div");
      fenetre.style.cssText = "position:absolute;left:0;overflow:hidden;width:" + m.largeur + "px;" +
        "top:" + m.decalage + "px;height:" + Math.max(1, m.fin - m.debut) + "px";
      const clone = sec.cloneNode(true);
      clone.style.position = "absolute"; clone.style.left = "0"; clone.style.top = (-m.debut) + "px";
      fenetre.appendChild(clone); enveloppe.appendChild(fenetre); racine.appendChild(enveloppe);
      cadre.insertBefore(hote, cadre.firstChild);
      return hote;
    };

    /* Page de CETTE vue qui correspond à la page `p` de la vue `ref` : même
       section, même rang de tranche (borné). Le résultat peut avoir un autre
       nombre de pages (les jetons changent la longueur des lignes). */
    vue.pagePour = (ref, p) => {
      const o = ref.pages[p];
      if (!o) return { page: 0, total: vue.nPages, differe: true };
      let page;
      if (vue.nSections === ref.nSections) {
        const mm = vue.pages.map((x, i) => [x, i]).filter(([x]) => x.section === o.section);
        const ici = mm.length ? mm[Math.min(o.tranche, mm.length - 1)][1] : Math.min(p, vue.nPages - 1);
        page = ici;
      } else page = Math.min(p, vue.nPages - 1);
      return { page, total: vue.nPages, differe: vue.nPages !== ref.nPages };
    };

    /* Texte affiché par le rendu, un bloc par ligne : sert à contrôler qu'une
       valeur a bien disparu de ce que l'aperçu montre (champs, numérotation). */
    vue.texteAffiche = () => {
      const lignes = [];
      for (const sec of rendu.sections) {
        let bloc = null, cur = "";
        for (const x of listerTexte(sec)) {
          if (x.br) { cur += "\n"; continue; }
          if (bloc && x.bloc !== bloc) { lignes.push(cur); cur = ""; }
          bloc = x.bloc; cur += x.t.data;
        }
        lignes.push(cur);
      }
      return lignes.join("\n");
    };

    vue.fermer = () => {
      vue.fermee = true;
      rendu.hote.remove();
      if (vue.stylePolices) { vue.stylePolices.remove(); vue.stylePolices = null; }
      rendu.sections.length = 0; rendu.styles.length = 0;
    };
    return vue;
  }

  /* ------------------------------------------------------------ interface */

  const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const souple = (v) => new RegExp(v.trim().split(/\s+/).map(echapper).join("\\s+"));

  const ApercuDocx = {
    /* Ouvre le .docx d'origine : rendu, pagination, index. `opts` : { actif()
       (faux = abandon), statut(msg) }. Renvoie { vue, index, mesures }. */
    async ouvrir(octets, opts = {}) {
      const statut = opts.statut || (() => {});
      const t0 = performance.now();
      statut("Mise en page du document Word…");
      const rendu = await rendre(octets, opts.actif);
      const t1 = performance.now();
      let vue = null;
      try {
        const pag = paginer(rendu);
        const t2 = performance.now();
        const index = await construireIndex(rendu, pag, {
          actif: opts.actif,
          progres: (f) => statut("Lecture du texte et des positions… " + Math.round(f * 100) + " %"),
        });
        vue = creerVue(rendu, pag);
        return { vue, index, mesures: { rendu: Math.round(t1 - t0), pagination: Math.round(t2 - t1),
                                        index: Math.round(performance.now() - t2),
                                        caracteres: index.texte.length } };
      } catch (e) {
        if (vue) vue.fermer(); else rendu.hote.remove();
        throw e;
      }
    },

    /* Rend le .docx PRODUIT (anonymisé) : pas d'index, juste les pages. */
    async ouvrirResultat(octets, opts = {}) {
      const rendu = await rendre(octets, opts.actif);
      try {
        return creerVue(rendu, paginer(rendu));
      } catch (e) { rendu.hote.remove(); throw e; }
    },

    /* Valeurs encore lisibles dans ce que l'aperçu du résultat AFFICHE (un
       champ ou une numérotation générés peuvent montrer ce que le XML ne
       contient pas). */
    valeursAffichees(vue, valeurs) {
      const texte = vue.texteAffiche();
      return [...new Set(valeurs)].filter(v => v && v.trim().length >= 3 && souple(v).test(texte));
    },

    _interne: { planifier, OPTIONS_RENDU },
  };

  global.ApercuDocx = ApercuDocx;
})(globalThis);
