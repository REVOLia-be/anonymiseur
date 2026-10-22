# Prototype — anonymisation PDF à mise en page préservée

**But :** vérifier, avant d'engager la refonte, qu'on peut afficher le PDF d'origine,
y montrer les détections à leur place réelle, et produire un PDF anonymisé **identique
en mise en page** — le tout dans le navigateur, sans rien envoyer.

**Verdict : faisable.** Les quatre inconnues sont levées. Quatre pièges sérieux ont été
trouvés au passage ; ils sont documentés plus bas et corrigés dans le code.

> Code **jetable**, conservé pour la valeur de ses conclusions et pour rejouer les mesures.
> Il n'est pas branché sur `index.html` du site et peut être supprimé une fois la refonte faite.

## Lancer

```bash
cd prototype
npm install                 # récupère mupdf (~10 Mo de WASM)
node cli.mjs fiche-reelle.pdf pseudo     # contrôle en ligne de commande
node cli.mjs fiche-reelle.pdf redact

python3 -m http.server 4601              # démonstration navigateur
# puis http://127.0.0.1:4601/index.html  (ajouter ?mode=redact pour le caviardage)
```

## Résultats mesurés

Document de test : fiche de paie A4 réaliste (polices embarquées et sous-ensemblées,
accents, tableau avec bordures et aplats, logo, pied de page).

| | Entrée | Sortie | Rapport |
|---|---|---|---|
| 1 page, 11 détections | 54 898 o | 54 311 o | **0,99×** |
| 3 pages, 20 détections | 58 688 o | 57 769 o | **0,98×** |

Navigateur (Chromium, Web Worker) : rendu 87 ms · anonymisation 59 ms · vérification 15 ms ·
**343 ms au total, chargement du WASM compris**.

- Mise en page **intacte** : logo, filets, tableau, couleurs, pied de page.
- Jetons **cohérents entre les pages** (même personne = même jeton p.1 et p.3) — indispensable
  pour la ré-identification.
- **Aucune fuite**, contrôlée sur le texte extrait *et* sur les octets bruts du document décompressé.
- Le poids reste celui du fichier d'origine : **la rasterisation n'est pas nécessaire.**

## Les quatre pièges trouvés

### 1. `garbage=compact` est une exigence de sécurité, pas une optimisation

Sans cette option de sauvegarde, `applyRedactions()` laisse **l'ancien flux de contenu intact**
dans le fichier, en objet orphelin. La page ne le référence plus, le texte semble supprimé…
et toutes les données sont récupérables.

```
sauvegarde "compress"                   → 1311 o — FUITE : e-mail, n° national, IBAN, nom
sauvegarde "compress,garbage=compact"   →  665 o — aucune fuite
```

Le fichier est même **plus petit** avec l'option. Retenu : `"compress,garbage=compact,sanitize=yes"`.

### 2. Tout tampon sortant de MuPDF doit être copié immédiatement

`asUint8Array()` et `asPNG()` renvoient une **vue sur le tas WASM**, pas une copie. La moindre
allocation ultérieure (un simple rendu de page) fait grandir ce tas et **détache la vue** :
longueur 0, sans la moindre erreur.

```
juste après asUint8Array  : 54 565 octets
après un rendu de page    :      0 octets   ← on livrerait un PDF vide
avec .slice()             : 54 565 octets
```

### 3. Un worker *module* perd les messages reçus pendant son initialisation

`self.onmessage` n'est installé qu'après l'évaluation des `import` — ici ~10 Mo de WASM.
Tout message envoyé avant est **perdu silencieusement** : pas d'erreur, pas de réponse, le
worker reste muet. C'est une course : le premier essai avait fonctionné par chance.
Parade retenue : le worker émet `{pret:true}` en fin d'évaluation, le thread principal attend
ce signal avant d'envoyer quoi que ce soit.

### 4. Les détections ne doivent pas traverser les sauts de ligne

`\s` dans une expression régulière franchit les `\n` et avale le début de la ligne suivante
(« Madame Sophie Vandenberghe\nNumero » → le mot « Numero » a été caviardé). Utiliser `[ \t]`.

## Comment c'est fait

| Rôle | Moyen |
|---|---|
| Positions | `page.toStructuredText(...).walk()` → **un quad et une origine par caractère** |
| Index | `text[i]` ↔ `quads[i]` : la détection travaille sur du texte, le rendu sur des rectangles |
| Caviardage | annotation `Redact` par rectangle, puis `applyRedactions()` |
| Jeton | flux de contenu ajouté à la page (`addSimpleFont` + `addStream`) : **vrai texte de page**, sélectionnable et extractible, pas une annotation |
| Ajustement | corps de police réduit tant que le jeton dépasse la largeur libérée |
| Isolation | MuPDF + WASM dans un Web Worker |

Options de caviardage retenues — elles préservent la mise en page :
`REDACT_IMAGE_PIXELS` (ne remplace que les pixels couverts, ne supprime pas l'image entière)
et `REDACT_LINE_ART_NONE` (ne supprime pas les tracés vectoriels traversés).

## Ce qui n'est PAS validé

- **PDF scannés** (pages images) : non testé ici. Le chemin OCR reste à relier.
- **PDF complexes** : pages pivotées, colonnes, formulaires, polices CID exotiques, PDF protégés.
- **Police du jeton** : Helvetica, visiblement différente de la police du document. On pourrait
  réutiliser la police d'origine (disponible dans `onChar`), au prix d'un greffage d'objet.
- **Texte plus court que l'original** : le jeton laisse un blanc là où le texte était plus long.
  Normal — on ne refait pas la mise en page — mais à décider visuellement (centrer ? aligner ?).
- **Pertes connues du ré-encodage** (signalées par le projet de référence `axtn/pdf-redactor`) :
  liens, formulaires, signets et signatures ne survivent pas comme éléments interactifs.
- La détection ici est volontairement minimale : elle sert à tester la plomberie PDF,
  pas à remplacer les règles et l'IA locale du site.

## Licence

MuPDF.js est en **AGPL-3.0 ou licence commerciale**. Le dépôt étant déjà en AGPL-3.0,
c'est compatible sans coût. À garder en tête : une version fermée ou un SaaS non publié
exigerait une licence commerciale auprès d'Artifex.
