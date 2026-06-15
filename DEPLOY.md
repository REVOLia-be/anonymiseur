# Déploiement — Anonymiseur REVOLia

Cible : **`anonymiseur.revolia.be`** · hébergement **Cloudflare Pages** · DNS via **one.com**.

---

## Vue d'ensemble

| Élément | Où | Pourquoi |
|---|---|---|
| App (HTML, libs, OCR, wasm, polices, logo) | **Cloudflare Pages** | site statique, fichiers < 25 Mo |
| Modèle IA (`models/`, ~135 Mo) | **Cloudflare R2** | dépasse la limite 25 Mo/fichier de Pages |
| Police **iBrand** (licence, hors dépôt public) | injectée au build depuis une **URL privée** | ne pas redistribuer la police dans le dépôt public |

> La détection par **règles**, l'**OCR** et tous les **exports** fonctionnent sans le modèle IA. Le modèle (R2) n'est requis que pour la détection contextuelle « IA locale ».

---

## 1. Pousser le code sur GitHub

Dépôt **public** (compte **REVOLia-be**) : `github.com/REVOLia-be/anonymiseur`.

```bash
git remote add origin git@github.com:REVOLia-be/anonymiseur.git
git push -u origin main
```

## 2. Modèle IA sur Cloudflare R2

1. Crée un bucket R2 (ex. `revolia-anonymiseur-assets`).
2. Récupère le modèle en local puis téléverse le dossier `models/` en conservant l'arborescence :
   ```bash
   bash fetch-assets.sh            # télécharge vendor/models/…
   # puis, avec wrangler :
   npx wrangler r2 object put revolia-anonymiseur-assets/models/Xenova/distilbert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx \
     --file vendor/models/Xenova/distilbert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx
   # (idem pour config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json)
   ```
   (ou via le tableau de bord R2, glisser-déposer en respectant les chemins.)
3. Expose le bucket en lecture publique via un **domaine personnalisé** (ex. `assets.revolia.be`) ou l'URL `r2.dev`.
4. **CORS** du bucket : autoriser l'origine `https://anonymiseur.revolia.be` (méthode GET).
5. Dans `index.html`, renseigne l'URL (le `/` final est important) :
   ```js
   window.ANON_MODEL_BASE = "https://assets.revolia.be/models/";
   ```
   puis commit. (Cette URL est publique : le modèle est un fichier ouvert, aucune donnée perso.)

## 3. Police iBrand (sans la mettre dans le dépôt public)

1. Téléverse `ibrand.otf` dans le bucket R2 (ou tout stockage privé) → obtiens une URL.
2. Dans Cloudflare Pages, ajoute une **variable d'environnement** de build :
   `IBRAND_URL` = l'URL du fichier `ibrand.otf`.

Sans cette étape, le mot-symbole « revolia » s'affiche en **Poppins** (repli) — l'app reste fonctionnelle.

## 4. Configurer Cloudflare Pages

- **Connecte le dépôt GitHub** `REVOLia-be/anonymiseur`.
- Framework preset : **None**.
- **Build command** :
  ```bash
  SKIP_MODEL=1 bash fetch-assets.sh && { [ -n "$IBRAND_URL" ] && curl -fsSL "$IBRAND_URL" -o vendor/fonts/ibrand.otf || true; }
  ```
  (récupère OCR + wasm < 25 Mo ; **saute** le modèle de 135 Mo ; injecte iBrand si l'URL est fournie.)
- **Build output directory** : `/` (racine).

## 5. Domaine (one.com → Cloudflare Pages)

1. Dans Pages → *Custom domains*, ajoute `anonymiseur.revolia.be`.
2. Cloudflare fournit une cible CNAME (ex. `anonymiseur-revolia.pages.dev`).
3. Chez **one.com** (DNS de `revolia.be`), crée un enregistrement **CNAME** :
   `anonymiseur` → `…​.pages.dev`.
4. Attends la propagation + l'émission du certificat TLS.

## 6. Vérifications post-déploiement

- [ ] La page se charge sur `https://anonymiseur.revolia.be`.
- [ ] Onglet **Réseau** : aucun envoi du **contenu** d'un document ; seules les ressources du site (et le modèle depuis R2) sont chargées.
- [ ] Détection par règles + OCR : OK.
- [ ] « Détection IA locale » : le modèle se charge depuis R2 (1er chargement plus long).
- [ ] Le mot-symbole s'affiche en iBrand (si `IBRAND_URL` configurée).
- [ ] Pages **Confidentialité** et **Mentions légales** accessibles.

## 7. Renforcement optionnel (après tests)

Ajouter une **CSP** dans `_headers` une fois validée (à tester car restrictive). Exemple à adapter (autoriser l'origine R2) :
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://assets.revolia.be; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'
```
Une `connect-src` limitée à `'self'` + R2 est un argument de confiance fort (le navigateur bloque toute autre sortie réseau).
