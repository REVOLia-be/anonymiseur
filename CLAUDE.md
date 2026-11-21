# CLAUDE.md — Anonymiseur REVOLia

Lis ce fichier avant de modifier le code. Il est public : n'y mets jamais de donnée réelle.

## Ce qu'est l'outil

- Site statique (HTML + JS, sans build, sans `npm install`) servi sur https://anonymiseur.revolia.be.
- Il anonymise un PDF, un Word (`.docx`), une image (JPG, PNG, WebP, GIF, BMP) ou un texte collé, avant un usage dans une IA.
- Tout le traitement a lieu dans le navigateur : détection (règles belges FR/NL, IA locale en option), masquage, vérification.

## Règles d'architecture à ne pas contourner

1. Rien ne quitte le navigateur : aucun document, aucun texte, aucune valeur détectée n'est envoyé à un serveur. N'ajoute aucun `fetch` vers l'extérieur, aucune ressource tierce au runtime, aucun outil de mesure.
2. La CSP de `_headers` interdit toute sortie réseau hors du site. `connect-src` doit toujours suivre l'adresse du modèle d'IA locale (`window.ANON_MODEL_BASE` dans `index.html`). Si cette adresse change, mets `_headers` à jour, sinon l'IA locale ne se charge plus.
3. La vérification avant téléchargement ne se contourne jamais. Elle relit le fichier produit (texte extrait et octets bruts) et bloque le téléchargement. Seule l'acceptation explicite, mention par mention, la lève. Jamais en bloc.
4. Aucune donnée réelle dans le dépôt (public) : ni dans le code, ni dans les tests, ni dans les messages de commit. Documents de test fictifs uniquement, noms fictifs, domaines « exemple ».
5. L'IA locale (`#nerToggle`) est décochée par défaut. Les règles, l'OCR et les exports fonctionnent sans elle.
6. Rien n'est stocké dans le navigateur : ni `localStorage`, ni `sessionStorage`, ni IndexedDB, ni cookie. Le profil métier vit dans l'adresse (`?metier=`). La table partagée entre documents reste en mémoire de l'onglet.
7. Le texte extrait d'un PDF n'est jamais normalisé (ni espaces, ni lignes vides) : les offsets de l'index doivent rester exacts.
8. Une valeur anonymisée l'est partout (toutes ses occurrences), et ses jetons ne se renumérotent pas (`[PERSONNE_1]` désigne la même valeur jusqu'à « Tout effacer »).
9. Pas de fichier lourd dans Git : les `.wasm`, le modèle et les langues OCR viennent de `fetch-assets.sh`. La police de marque `ibrand.otf` n'est jamais commitée.

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Interface et logique principale. Plus de 3000 lignes : cherche par mot-clé (`MoteurPdf`, `creerMoteurDocx`, `ocrPdfPages`, `telechargerFidele`). |
| `js/regles.js` | Règles de détection belges FR/NL, profils métier, jetons, ré-identification. Pur (sans DOM), chargé aussi par Node. |
| `js/codes-postaux.js` | Liste officielle des codes postaux et localités belges. |
| `js/anon-geom.js` | Géométrie : de l'index texte aux rectangles sur la page. |
| `js/anon-pdf.js` | Opérations MuPDF : index, rendu, caviardage, vérification, image vers PDF. Testable sous Node. |
| `js/pdf-worker.js` | Web Worker (module) autour de `anon-pdf.js`. |
| `js/anon-docx.js` | Anonymisation d'un `.docx` par édition du XML (`globalThis.AnonDocx`). |
| `js/apercu-docx.js` | Aperçu Word : docx-preview dans un Shadow DOM, pages virtuelles, index (`globalThis.ApercuDocx`). |
| `js/recapitulatif.js` | Récapitulatif `.txt` d'une page, sans aucune valeur. |
| `_headers` | En-têtes Cloudflare Pages : CSP, cache. |
| `404.html` | Page « introuvable » avec lien de retour vers l'outil. |
| `fetch-assets.sh` | Télécharge les gros fichiers exclus du dépôt. |
| `vendor/` | Bibliothèques embarquées (MuPDF, Tesseract, docx-preview, JSZip, jsPDF, docx, mammoth, Transformers.js, polices). |
| `tests/` | Tests sous Node et documents fictifs. `tests/README.md` détaille les pièges. |
| `README.md`, `DEPLOY.md` | Fonctionnalités, déploiement. |

## Développement local

```bash
bash fetch-assets.sh               # une fois après le clone
python3 -m http.server 4599        # puis http://localhost:4599
```

Un serveur est obligatoire : le moteur PDF tourne dans un Web Worker et charge du WebAssembly (impossible en `file://`). En local, le modèle d'IA est lu dans `vendor/models/` ; `SKIP_MODEL=1 bash fetch-assets.sh` le saute.

## Tests (à faire passer avant toute pull request)

```bash
cd tests
node regles.mjs                                   # règles : couverture du corpus, faux positifs, ~440 contrôles
node fabrique-docx.mjs                            # régénère fiche-word.docx (fictif)
node chaine-docx.mjs fiche-word.docx pseudo       # Word : ~50 assertions (aussi : redact, contrat-synthetique.docx)
node chaine.mjs fiche-reelle.pdf pseudo           # PDF : positions, caviardage, vérification (aussi : redact)
node apercu-docx.cjs http://127.0.0.1:4599        # aperçu Word, avec Playwright, site servi en local
```

- Code de sortie 1 en cas de fuite ou de résultat sous les seuils inscrits en tête de `regles.mjs`. Relève les seuils quand les règles progressent, jamais l'inverse.
- `chaine.mjs` a besoin de `vendor/mupdf/mupdf-wasm.wasm` : lance `fetch-assets.sh` d'abord.
- `SANS_LIBREOFFICE=1` saute la relecture par LibreOffice dans `chaine-docx.mjs`.
- Pas de test automatisé de l'interface : vérifie à la main dans le navigateur, sur chaque parcours touché (PDF, scan, image, Word, texte collé, IA locale).

## Pièges principaux (détail : `tests/README.md`)

- PDF : sauvegarder avec `compress,garbage=compact,sanitize=yes`. Sans `garbage=compact`, l'ancien flux reste dans le fichier.
- MuPDF : tout tampon rendu est une vue sur le tas WASM. Copie-le (`.slice()`) avant toute autre allocation, sinon il est vidé en silence.
- Le worker PDF est un module : il perd les messages reçus avant son initialisation. Attends `{pret:true}`.
- Dans un PDF, la même donnée vit à plusieurs endroits : liens, texte alternatif, métadonnées, signets. Le caviardage n'atteint que la page.
- Ne balaie pas tous les objets du PDF (le fichier perd ses images). Descends l'arbre de structure seulement.
- Word : le texte est coupé en runs. Raisonne par paragraphe, pas par `w:t`. Pense aux révisions supprimées, champs, zones de texte (écrites deux fois), commentaires, métadonnées, vignette.
- JSZip : écris avec `{ createFolders: false, date: ancienneDate }`, sinon l'archive change.
- docx-preview ne coupe les pages que sur les sauts explicites : les pages de l'aperçu sont virtuelles. Garde le Shadow DOM.
- Ce que l'aperçu Word ne montre pas (commentaires, texte supprimé, champs) passe par les règles (`texteHorsApercu`), mais pas par l'IA locale. Les images d'un Word ne sont pas analysées.
- Scans et images : un mot mal lu par l'OCR n'est pas masqué, et la vérification ne peut rien prouver sur une image. L'interface doit le dire.
- Règles : `\b` ne voit que l'ASCII (« Liège »), `\s` franchit les sauts de ligne (utilise `[ \t]`), et chaque expression doit rester linéaire (chronométrage dans `regles.mjs`).

## Conventions

- Français partout, phrases courtes. Code et commentaires : tutoiement. Interface du site : vouvoiement (« votre document »).
- Aucune donnée réelle, jamais : noms fictifs, numéros d'exemple, domaines « exemple ». N'ajoute pas au dépôt un document qui vient d'un vrai dossier.
- Un défaut trouvé devient un cas de test et, s'il est subtil, un piège documenté dans `tests/README.md`.
- Branche, pull request, puis fusion squash dans `main`. `main` est publié automatiquement par Cloudflare Pages. Fais passer les tests avant d'ouvrir la pull request.
- Licence : AGPL-3.0 (MuPDF.js l'exige). La marque et le logo REVOLia ne sont pas couverts par la licence.
