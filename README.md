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
- **Validation humaine** : aperçu surligné, activation par catégorie, termes personnalisés, liste d'exclusion.
- **Deux modes** : pseudonymisation cohérente (`[PERSONNE_1]`) ou **caviardage réel** (les données sont supprimées, pas seulement masquées).
- **Exports** : `.txt`, `.pdf`, `.docx`.
- **Ré-identification** : réinjectez les vraies données dans la réponse de l'IA, en local.
- **100 % hors-ligne** : aucune ressource tierce chargée au runtime.

## 🔒 Confidentialité

Le contenu de vos documents **ne quitte jamais votre appareil**. Aucune collecte, aucun cookie de suivi, aucun compte.
Voir [`confidentialite.html`](confidentialite.html). C'est vérifiable : le code est ouvert et l'onglet « réseau » du
navigateur ne montre aucune transmission de contenu.

> ⚠️ **Outil d'aide, pas de garantie.** Aucune détection automatique n'est exhaustive ; la pseudonymisation n'est pas
> une anonymisation au sens du RGPD ; les identifiants indirects ne sont pas détectés. **Relisez toujours** le résultat.

## 🚀 Démarrage local

```bash
# 1. Récupérer les gros fichiers (modèle IA, OCR, runtime) exclus du dépôt
bash fetch-assets.sh

# 2. Servir le site (n'importe quel serveur statique)
python3 -m http.server 4599

# 3. Ouvrir http://localhost:4599
```

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
| Lecture PDF | [PDF.js](https://github.com/mozilla/pdf.js) |
| OCR | [Tesseract.js](https://github.com/naptha/tesseract.js) |
| Lecture Word | [mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| Détection IA (NER) | [Transformers.js](https://github.com/huggingface/transformers.js) + `Xenova/distilbert-base-multilingual-cased-ner-hrl` |
| Export PDF | [jsPDF](https://github.com/parallax/jsPDF) |
| Export Word | [docx](https://github.com/dolanmiu/docx) |
| Police texte | [Poppins](https://fonts.google.com/specimen/Poppins) (OFL) |

Chaque dépendance reste sous sa propre licence.

## 📄 Licence

Code source sous **GNU AGPL-3.0** — voir [`LICENSE`](LICENSE).
Toute version modifiée **et hébergée** doit rendre son code source disponible.

**Marque, nom et logo « REVOLia »** (caméléon & signe verbal) : propriété de REVOLia, **non** couverts par cette licence.
**Police iBrand** : licence commerciale détenue par REVOLia, non redistribuée.

---

*Fait par REVOLia — IA responsable. Le caméléon : l'art de se fondre dans le décor. 🦎*
