# 🦎 Anonymiseur REVOLia

> Anonymisez un document **avant** de l'utiliser dans une IA — **sans rien installer, sans que vos données ne quittent votre ordinateur.**

Un outil web gratuit qui repère les informations identifiantes d'un document (contrat, fiche de paie, courrier médical, rapport…) et les remplace, pour que vous puissiez utiliser le document dans ChatGPT, Claude, Gemini, etc. sans exposer de données personnelles.

**Tout le traitement se fait dans le navigateur. Rien n'est envoyé à un serveur.**

---

## ✨ Fonctionnalités

- **Entrées** : PDF (texte **et scanné**), Word (`.docx`), images (JPG/PNG), ou texte collé.
- **OCR local** des documents scannés et images (Tesseract.js, français).
- **Détection** combinée :
  - règles (e-mail, téléphone, IBAN, **n° national belge**, **n° d'entreprise/TVA BE**, carte, dates, montants, code postal…) ;
  - **IA locale** optionnelle (noms, lieux/adresses, organisations) via un modèle de reconnaissance d'entités tournant dans le navigateur.
- **PDF : mise en page préservée.** Le document s'affiche page par page, les détections sont surlignées **à leur place réelle**, et le PDF produit est le document d'origine — mêmes polices, même mise en page, même poids — avec les données en moins. Pas de rasterisation.
- **PDF scannés** : l'OCR fournit une boîte par mot reconnu, d'où le même traitement — zones sur la page et effacement réel des pixels. ⚠️ La fiabilité dépend entièrement de la reconnaissance : **un mot mal lu n'est pas détecté, donc pas masqué**, et la vérification par extraction de texte ne peut rien confirmer sur une image. L'outil le dit explicitement.
- **Validation humaine** : clic sur une zone pour l'écarter ou la remettre (toutes ses occurrences suivent), activation par catégorie, liste d'exclusion. **Ce que la détection a raté se désigne sur le document** : un clic sur un mot, ou un cliqué-glissé sur une zone, et le terme est masqué partout.
- **Deux modes** : pseudonymisation cohérente (`[PERSONNE_1]`, écrite dans la couleur du texte remplacé) ou **caviardage réel** (les données sont supprimées, pas seulement masquées).
- **Vérification avant téléchargement** : l'outil relit le fichier qu'il vient de produire et cherche chaque valeur anonymisée dans le texte extrait **et** dans les octets bruts du document décompressé. Une vérification en échec **bloque** le téléchargement, en indiquant pour chaque mention restante **où** elle subsiste (texte d'une page, ou ailleurs dans le fichier). Le blocage se lève mention par mention, par une acceptation explicite — jamais en bloc.
- **Exports** : `.txt`, `.pdf`, `.docx`.
- **Ré-identification** : réinjectez les vraies données dans la réponse de l'IA, en local.
- **100 % hors-ligne** : aucune ressource tierce chargée au runtime.

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
```

Éprouve la chaîne complète (positions → caviardage → vérification) hors navigateur, contre les modules
de production et le moteur vendoré — **sans `npm install`**. Le code de sortie vaut 1 en cas de fuite.
[`tests/README.md`](tests/README.md) documente les **pièges connus** et pourquoi le code est écrit ainsi :
plusieurs échouent en silence, et chacun a été constaté sur un document réel.

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
| Lecture Word | [mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| Détection IA (NER) | [Transformers.js](https://github.com/huggingface/transformers.js) + `Xenova/distilbert-base-multilingual-cased-ner-hrl` |
| Export PDF du texte collé (sans mise en page) | [jsPDF](https://github.com/parallax/jsPDF) |
| Export Word | [docx](https://github.com/dolanmiu/docx) |
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
