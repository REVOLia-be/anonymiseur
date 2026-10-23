# Tests & pièges connus

Éprouve la chaîne complète — index texte ↔ positions, caviardage, écriture des
jetons, vérification — sur un vrai PDF, **hors navigateur**. Les modules testés
sont ceux de production (`js/anon-pdf.js`, `js/anon-geom.js`) et le moteur est
celui du site (`vendor/mupdf/`) : **aucun `npm install` n'est nécessaire**.

```bash
cd tests
node chaine.mjs fiche-reelle.pdf pseudo     # document bien construit
node chaine.mjs fiche-reelle.pdf redact
node chaine.mjs /chemin/vers/un.pdf pseudo  # un de vos documents
```

Sortie : nombre de pages, détections, consignes, poids avant/après, liens et
annotations retirés, et le verdict de vérification. Le code de sortie vaut 1
en cas de fuite — utilisable tel quel dans un script.

> La détection du harnais est volontairement minimale : il éprouve la
> **plomberie PDF**, pas la qualité des règles ni l'IA locale du site.

`fiche.html` sert à régénérer `fiche-reelle.pdf` (impression via un navigateur) :
une fiche de paie réaliste, avec polices embarquées, accents, tableau bordé,
aplats et logo.

> ⚠️ Ne jamais déposer ici un document client : le dépôt est **public**.
> Passez le chemin en argument depuis un dossier hors dépôt.

---

## Les pièges trouvés, et pourquoi le code est écrit ainsi

Chacun a été constaté sur un document réel. Plusieurs échouent **en silence**.

### 1. `garbage=compact` à la sauvegarde est une exigence de sécurité

Sans cette option, `applyRedactions()` laisse l'ancien flux de contenu dans le
fichier, en objet orphelin : la page ne le référence plus, le texte semble
supprimé, et tout reste récupérable.

```
sauvegarde "compress"                   → 1311 o — FUITE : e-mail, n° national, IBAN, nom
sauvegarde "compress,garbage=compact"   →  665 o — aucune fuite
```

Le fichier est même **plus petit** avec l'option.

### 2. Tout tampon rendu par MuPDF est une vue sur le tas WASM

`asUint8Array()` et `asPNG()` ne renvoient pas une copie. La moindre allocation
ultérieure — un simple rendu de page — fait grandir le tas et **détache la
vue** : longueur 0, sans la moindre erreur. On livrerait un PDF vide.

```
juste après asUint8Array  : 54 565 octets
après un rendu de page    :      0 octets
avec .slice()             : 54 565 octets
```

### 3. Un worker *module* perd les messages reçus pendant son initialisation

`self.onmessage` n'existe qu'après l'évaluation des `import` — ici ~10 Mo de
WASM. Tout message envoyé avant est **perdu sans erreur** : le worker reste
muet. C'est une course, gagnée ou perdue selon la machine. D'où le signal
`{pret:true}` que le thread principal attend.

### 4. Caviarder le texte ne suffit pas — trois couches parallèles

Une même donnée peut vivre ailleurs que dans le texte dessiné :

- **les liens.** Une adresse disparaissait de la page et restait dans un lien
  `mailto:`. Supprimer le lien **ne suffit pas** : l'objet survit au
  ramasse-miettes tant que l'arbre de structure le référence. Il faut
  neutraliser l'URI **avant** de supprimer — et avec une URI *valide*,
  `setURI("")` lève « unsupported link URI type » ;
- **le texte alternatif d'accessibilité** (`/Alt`, `/ActualText`, `/E`, `/TU`).
  Couche parallèle que rien ne dessine, que le caviardage ne touche pas, et
  qu'un extracteur ou un lecteur d'écran lit. Un logo portait `Alt(REVOLia)` ;
  l'alt d'une photo pourrait être le nom de la personne ;
- **les métadonnées** : titre, auteur, logiciel et machine d'origine.

### 5. Ne pas balayer tous les objets du document

Premier correctif pour le point précédent : parcourir `countObjects()` et
modifier au passage. Résultat — le fichier produit **perdait un mégaoctet
d'images** (2 204 774 → 1 210 665 octets) et devenait illisible par endroits.
On ne descend que l'arbre de structure.

### 6. `preserve-spans` hache le texte des PDF de mise en page

Sur un export à polices Type3 (un glyphe = une procédure), cette option fait
émettre **une ligne par fragment** : 275 lignes pour 18 lignes réelles, et un
texte en confettis (`F\norm\ne\nr`). Sans elle, MuPDF regroupe correctement.

### 7. Le texte extrait ne doit PAS être normalisé

Supprimer les espaces multiples ou les lignes vides décale les offsets, et
l'index texte ↔ page ne correspond plus. Chaque caractère garde sa position.

### 8. Une détection ne doit pas traverser un saut de ligne

`\s` franchit `\n` et avale le début de la ligne suivante : « Madame Sophie
Vandenberghe\nNumero » a fait caviarder le mot « Numero ». Utiliser `[ \t]`.
À l'inverse, pour **regrouper** une entité, le saut de ligne doit être accepté :
un PDF coupe volontiers « Claire\nHanssen » en fin de ligne.

### 9. Une valeur anonymisée doit l'être PARTOUT

L'outil ne masquait que les occurrences *détectées*. Les règles les trouvent
toutes, mais l'IA en rate : sur un devis réel, « REVOLia » repéré **1 fois sur
17**, « Adminova » 12 sur 16. La valeur restait lisible ailleurs. Les
occurrences manquantes sont désormais complétées par recherche dans le texte.

### 10. Le contrôle des octets bruts est aveugle sur certains PDF

La vérification cherche chaque valeur dans le texte extrait **et** dans les
octets bruts du document décompressé. Sur un PDF à polices Type3, le texte est
encodé en codes de glyphes, pas en ASCII : le scan d'octets ne trouve **rien**
alors que le texte est parfaitement extractible. Les deux contrôles sont
complémentaires — le scan d'octets, lui, avait seul attrapé le flux orphelin
(nº 1) et le lien `mailto:` (nº 4).

### 11. Un espace n'interrompt pas une ligne d'écriture

L'OCR donne une boîte par **mot**. Pour recoller « 11 juin 2026 » en un seul
rectangle, deux choses sont nécessaires : fusionner les boîtes sur
recouvrement vertical plutôt que sur ordonnée identique (deux boîtes OCR ne
s'alignent jamais au point près), et distinguer dans l'index le **saut de
ligne**, qui termine la ligne d'écriture, de l'**espace entre deux mots**, qui
ne la termine pas. Confondus, chaque mot formait son propre rectangle et le
jeton s'écrivait dans le premier, minuscule et illisible.

### 12. Les signets sont encore une autre couche de texte

Le titre d'un signet n'est pas dessiné sur la page, le caviardage ne le
touche pas, et un lecteur de PDF l'affiche dans son panneau de navigation.
Un export Word en crée un par titre de section : « Dossier Madame X » y
survivait intact. Les titres contenant une valeur anonymisée sont remplacés
plutôt que supprimés, pour ne pas casser l'arborescence.

C'est la **cinquième** couche parallèle trouvée après le texte de la page :
flux orphelin, liens, texte alternatif d'accessibilité, métadonnées, signets.
La leçon tient en une phrase : *dans un PDF, la même donnée vit à plusieurs
endroits, et le caviardage n'en atteint qu'un seul.*

### 13. Le nom du fichier est la dernière fuite

« Devis pour Dupont.pdf » reste parlant même quand le contenu est propre, et
le producteur du PDF range souvent ce nom dans ses métadonnées. L'outil
propose donc les mots du nom comme termes à masquer, et applique le même
remplacement au nom du fichier produit.

Quand une mention subsiste malgré tout, la vérification indique désormais le
**type d'objet PDF** qui l'héberge (métadonnées, signet, lien, pièce jointe,
flux de contenu…), parce que « ailleurs dans le fichier » ne suffit pas pour
décider quoi faire.

---

## Licence du moteur

MuPDF.js est en **AGPL-3.0 ou licence commerciale**. Le dépôt étant en
AGPL-3.0, c'est compatible sans coût. Une version fermée ou un SaaS non publié
exigerait une licence commerciale auprès d'Artifex.
