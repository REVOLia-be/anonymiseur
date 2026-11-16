# 🦎 Anonymiseur REVOLia

> Anonymisez un document **avant** de l'utiliser dans une IA — **sans rien installer, sans que vos données ne quittent votre ordinateur.**

Un outil web gratuit qui repère les informations identifiantes d'un document (contrat, fiche de paie, courrier médical, rapport…) et les remplace, pour que vous puissiez utiliser le document dans ChatGPT, Claude, Gemini, etc. sans exposer de données personnelles.

**Tout le traitement se fait dans le navigateur. Rien n'est envoyé à un serveur.**

---

## ✨ Fonctionnalités

- **Entrées** : PDF (texte **et scanné**), Word (`.docx`), images (JPG, PNG, WebP, GIF, BMP — HEIC seulement si le navigateur sait le décoder), ou texte collé.
- **OCR local** des documents scannés et images (Tesseract.js, français).
- **Détection** combinée :
  - règles belges FR/NL, dans `js/regles.js` (testées sous Node) : e-mail (y compris écrit « x (at) exemple.org »), téléphone (belge et étranger : +33, +31, +352, +49, +44…), IBAN (tous pays, clé modulo 97), **n° national** et **n° d'entreprise BE** (clé de contrôle, ou mot de contexte si la clé est fausse), n° **INAMI / RIZIV**, carte d'identité, plaque, référence de dossier (après « n°, réf., dossier, matricule »), carte bancaire (Luhn), dates (mois FR et NL, format ISO), montants, **code postal + commune** (composées entières : « Woluwe-Saint-Lambert »), **rue** française (par mot-clé) et néerlandaise (par suffixe : « -straat », « -laan »…), noms derrière un titre FR/NL (« Mme Van den Broeck », « De heer Pieter De Smet ») ;
  - **IA locale** optionnelle (noms, lieux/adresses, organisations) via un modèle de reconnaissance d'entités tournant dans le navigateur.
- **PDF : mise en page préservée.** Le document s'affiche page par page, les détections sont surlignées **à leur place réelle**, et le PDF produit est le document d'origine — mêmes polices, même mise en page, même poids — avec les données en moins. Pas de rasterisation.
- **Word (`.docx`) : mise en page préservée, comme un PDF.** Le document s'ouvre dans le même atelier (aperçu page par page, détections à leur place, vues Original / Anonymisé / Côte à côte, gestes, noms repérés, vérification) et **ressort en `.docx`** : on édite le XML du Word, on ne le convertit pas. Le remplacement est global — corps, en-têtes, pieds, notes, commentaires, texte supprimé en suivi des modifications, codes de champ, liens, attributs, métadonnées. L'**aperçu** est une interprétation du navigateur (polices de remplacement, pagination approchée : les « pages » d'un document sans saut explicite sont découpées entre deux lignes) ; le fichier produit, lui, garde la mise en page d'origine. Le contenu des images et des objets incorporés n'est **pas analysé** : l'outil le signale, et la vérification bloque si une valeur y subsiste. Un `.doc` ancien doit d'abord être enregistré en `.docx`.
- **Images** : une image déposée s'ouvre dans le même atelier qu'un PDF scanné d'une page (aperçu, zones, côte à côte, gestes, vérification) et ressort en PDF d'une page dont les pixels masqués sont réellement effacés. Elle est d'abord décodée et ré-encodée dans le navigateur : orientation EXIF appliquée, réduite à 3000 px au plus, et **métadonnées EXIF (GPS, appareil, date) retirées**.
- **PDF scannés** : l'OCR fournit une boîte par mot reconnu, d'où le même traitement — zones sur la page et effacement réel des pixels. ⚠️ La fiabilité dépend entièrement de la reconnaissance : **un mot mal lu n'est pas détecté, donc pas masqué**, et la vérification par extraction de texte ne peut rien confirmer sur une image. L'outil le dit explicitement.
- **Noms propres repérés** : les règles ne reconnaissent un nom que derrière un titre («&nbsp;Madame&nbsp;»). Les suites de mots capitalisés sont donc repérées sur leur forme et **proposées** — jamais masquées d'office, car « Haute École » en fait partie. Mesuré sur un devis de 13 pages : 7 candidats, les 2 vrais noms en tête.
- **Nom du fichier** : les mots du nom d'origine sont proposés comme termes à masquer (un nom de fichier trahit souvent le client), et le même remplacement est appliqué au nom du fichier produit.
- **Validation humaine** : clic sur une zone pour l'écarter ou la remettre (toutes ses occurrences suivent), activation par catégorie, liste d'exclusion. **Ce que la détection a raté se désigne sur le document** : un clic sur un mot, ou un cliqué-glissé sur une zone, et le terme est masqué partout.
- **Deux modes** : pseudonymisation cohérente (`[PERSONNE_1]`, écrite dans la couleur du texte remplacé) ou **caviardage réel** (les données sont supprimées, pas seulement masquées).
- **Vérification avant téléchargement** : l'outil relit le fichier qu'il vient de produire et cherche chaque valeur anonymisée dans le texte extrait **et** dans les octets bruts du document décompressé. Une vérification en échec **bloque** le téléchargement, en indiquant pour chaque mention restante **où** elle subsiste (texte d'une page, ou ailleurs dans le fichier). Le blocage se lève mention par mention, par une acceptation explicite — jamais en bloc.
- **Exports** : le fichier anonymisé fidèle (PDF, ou Word pour un Word), `.txt`, et — pour le texte collé et les PDF — un `.pdf` / `.docx` reconstruit sans mise en page.
- **Jetons stables** : une fois attribué, `[PERSONNE_1]` désigne la même valeur jusqu'au changement de document ou au bouton « Vider », même si l'on écarte ou ajoute d'autres détections. Les numéros peuvent donc sauter (`PERSONNE_1`, `PERSONNE_3`) : une réponse d'IA déjà obtenue reste ré-identifiable avec le bon nom.
- **Ré-identification** : réinjectez les vraies données dans la réponse de l'IA, en local. L'outil tolère les variantes courantes des jetons de la table (`PERSONNE_1` sans crochets, `[ personne_1 ]`) et rend des comptes : jetons remplacés, jetons `[XXX_n]` inconnus de la table, jetons de la table absents de la réponse.
- **100 % hors-ligne** : aucune ressource tierce chargée au runtime.

> Pour un Word, le texte détecté est celui que **l'aperçu affiche** : un texte que l'aperçu ne montre pas
> (commentaires, révisions supprimées, certains champs) est nettoyé des valeurs détectées ailleurs, mais n'est
> pas détecté en lui-même.
>
> Le ré-encodage d'un PDF retire **liens, formulaires, signets et signatures** en tant qu'éléments interactifs,
> ainsi que les métadonnées. C'est annoncé dans l'outil avant le téléchargement.

## 🔒 Confidentialité

Le contenu de vos documents **ne quitte jamais votre appareil**. Aucune collecte, aucun cookie de suivi, aucun compte.
Voir [`confidentialite.html`](confidentialite.html). C'est vérifiable : le code est ouvert et l'onglet « réseau » du
navigateur ne montre aucune transmission de contenu.

> ⚠️ **Outil d'aide, pas de garantie.** Aucune détection automatique n'est exhaustive ; la pseudonymisation n'est pas
> une anonymisation au sens du RGPD ; les identifiants indirects ne sont pas détectés. **Relisez toujours** le résultat.

## 🚀 Démarrage local

```bash
# 1. Récupérer les gros fichiers (moteur PDF, modèle IA, OCR, runtime) exclus du dépôt
bash fetch-assets.sh

# 2. Servir le site (n'importe quel serveur statique)
python3 -m http.server 4599

# 3. Ouvrir http://localhost:4599
```

Un serveur est indispensable : le moteur PDF tourne dans un **Web Worker** et charge son WebAssembly,
ce qu'un fichier ouvert en `file://` ne permet pas.

## 🧪 Tests

```bash
cd tests && node chaine.mjs fiche-reelle.pdf pseudo
cd tests && node regles.mjs                      # règles : couverture, faux positifs, cas unitaires
```

Pour un Word : `cd tests && node chaine-docx.mjs fiche-word.docx pseudo` (module `js/anon-docx.js`, une cinquantaine d'assertions, relecture par LibreOffice si présent). L'aperçu (`js/apercu-docx.js`) a besoin d'un navigateur : voir `tests/README.md`, « Word : l'aperçu ».

Éprouve la chaîne complète (positions → caviardage → vérification) hors navigateur, contre les modules
de production et le moteur vendoré — **sans `npm install`**. Le code de sortie vaut 1 en cas de fuite.
[`tests/README.md`](tests/README.md) documente les **pièges connus** et pourquoi le code est écrit ainsi :
plusieurs échouent en silence, et chacun a été constaté sur un document réel.

`regles.mjs` mesure les règles sur un corpus **synthétique** belge FR/NL (103 valeurs sensibles) : 80 sont masquées en entier, aucune à moitié, et le code de sortie vaut 1 sous les seuils. Un texte sans donnée personnelle plafonne les faux positifs.

> La police de marque **iBrand** (`vendor/fonts/ibrand.otf`) est sous licence commerciale et n'est **pas** incluse.
> Sans elle, le mot-symbole « revolia » s'affiche en Poppins. Placez votre fichier licencié à cet emplacement pour
> retrouver l'identité exacte.

## ☁️ Déploiement

Site **statique** → hébergeable sur Cloudflare Pages, Netlify, GitHub Pages, etc.
Pensez à exécuter `fetch-assets.sh` à l'étape de build (les binaires ne sont pas dans le dépôt), et à fournir
`vendor/fonts/ibrand.otf` si vous disposez de la licence.

## 🧱 Pile technique (tout en local)

| Besoin | Bibliothèque |
|---|---|
| Lecture PDF, positions, rendu **et caviardage réel** | [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) (AGPL-3.0 ou licence commerciale) |
| OCR | [Tesseract.js](https://github.com/naptha/tesseract.js) |
| Aperçu Word (rendu des pages) | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.3.5 (Apache-2.0) |
| Lecture et réécriture de l'archive `.docx` | [JSZip](https://github.com/Stuk/jszip) 3.10.1 (MIT ou GPL-3.0) |
| Lecture Word de repli (texte seul) | [mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| Détection IA (NER) | [Transformers.js](https://github.com/huggingface/transformers.js) + `Xenova/distilbert-base-multilingual-cased-ner-hrl` |
| Export PDF du texte collé (sans mise en page) | [jsPDF](https://github.com/parallax/jsPDF) |
| Export Word du texte collé (sans mise en page) | [docx](https://github.com/dolanmiu/docx) |
| Police texte | [Poppins](https://fonts.google.com/specimen/Poppins) (OFL) |

Chaque dépendance reste sous sa propre licence.

> **MuPDF.js est en AGPL-3.0 ou licence commerciale.** Ce dépôt étant en AGPL-3.0, c'est compatible sans coût.
> Une version fermée, ou un SaaS dont le code ne serait pas publié, exigerait une licence commerciale auprès d'Artifex.

## 📄 Licence

Code source sous **GNU AGPL-3.0** — voir [`LICENSE`](LICENSE).
Toute version modifiée **et hébergée** doit rendre son code source disponible.

**Marque, nom et logo « REVOLia »** (caméléon & signe verbal) : propriété de REVOLia, **non** couverts par cette licence.
**Police iBrand** : licence commerciale détenue par REVOLia, non redistribuée.

---

*Fait par REVOLia — IA responsable. Le caméléon : l'art de se fondre dans le décor. 🦎*
