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

**Word (`.docx`)**

Même principe pour `js/anon-docx.js` : on édite le XML du Word, on ne le
convertit pas. Le module est un script classique (`globalThis.AnonDocx`) ; JSZip
(`vendor/jszip.min.js`) est la seule dépendance, **aucun `npm install`**.

```bash
cd tests
node fabrique-docx.mjs                         # régénère fiche-word.docx (synthétique, tous les cas)
node fabrique-docx-lib.cjs                     # régénère contrat-synthetique.docx (produit par la lib docx)
node chaine-docx.mjs fiche-word.docx pseudo    # + ~50 assertions dures sur cette fiche
node chaine-docx.mjs fiche-word.docx redact
node chaine-docx.mjs contrat-synthetique.docx pseudo
node chaine-docx.mjs /chemin/vers/un.docx pseudo   # un de vos documents
```

Le compte rendu donne parties lues, détections, remplacements par partie,
liens, métadonnées, auteurs, vignette, avertissements, puis les contrôles :
XML bien formé (équilibrage des balises), nombre de paragraphes inchangé, noms
d'entrées du zip inchangés, relecture par `extraireTexte` et par mammoth, et —
si `soffice` est installé — conversion en PDF par LibreOffice **puis
vérification du PDF** avec `anon-pdf.js` (`SANS_LIBREOFFICE=1` pour l'ignorer).
La sortie est écrite à côté du fichier d'entrée, ou dans le dossier temporaire
si celui-ci est dans le dépôt. Code de sortie 1 en cas de fuite ou d'échec.

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

### 14. Un nom sans titre échappe aux règles

« Monsieur Dupont » passe, « Sacha Munaut » non. Sur un devis réel de 13
pages, la détection par règles masquait montants, dates, e-mail, TVA et code
postal, et laissait en clair les deux noms de personnes et l'organisation
cliente — l'essentiel.

Une suite de mots capitalisés est un indice fiable, mesuré sur trois
documents : 7 candidats sur 13 pages, les 2 vrais noms en tête. Mais
« Haute École » et « Utiliser Canva » en font partie : ce sont des
SUGGESTIONS, validées d'un clic, jamais un masquage d'office. Masquer de
travers abîme le document sans rien protéger.

### 15. Une image réécrite en PDF sans « compress » gonfle d'un facteur 60 à 160

Pour ouvrir une image dans l'atelier, MuPDF la lit comme un document puis la
réécrit en PDF (`DocumentWriter`). Avec les options vides, les pixels sont
écrits bruts :

```
PNG de 150 Ko (1490 × 2108)    "" → 9 426 289 o      "compress" → 152 493 o
PNG de 4172 × 5901             "" → 73 860 447 o     "compress" → 456 306 o
```

Les bornes d'une page-image dépendent aussi de la densité (dpi) déclarée :
la taille en pixels se lit sur `mupdf.Image`, pas sur le pixmap d'une page
rendue à l'échelle 1.

---

## Word : les pièges

Mesurés sur `fiche-word.docx` (synthétique, construite pour les réunir) et sur
`contrat-synthetique.docx` (produit par la bibliothèque `docx`). La leçon est
la même que pour le PDF, avec d'autres couches : *dans un .docx, la même donnée
vit à plusieurs endroits, et remplacer le texte n'en atteint qu'un.*

### W1. Word coupe le texte en « runs » : la recherche par `w:t` rate presque tout

Correcteur orthographique (`w:proofErr`), changement de style, signets : « Sophie
Vandenberghe » s'écrit `Madame Sophie Vanden` · `ber` (gras) · `ghe` avec un
`proofErr` et un `bookmarkStart` entre les runs. Sur `fiche-word.docx`,
`document.xml` contient 6 occurrences lisibles de « Sophie Vandenberghe » ;
**une seule** tient dans un seul `w:t`. Il faut raisonner par PARAGRAPHE :
concaténer les `w:t`, chercher, puis écrire le jeton dans le premier `w:t`
touché et retirer la partie couverte des suivants. Le run central reste, vide,
avec sa mise en forme : la mise en page est conservée.

### W2. Les blancs de la valeur ne sont pas ceux du document

La valeur « Sophie Vandenberghe » se présente dans le même fichier avec une
espace insécable (U+00A0), une tabulation (`<w:tab/>` : un élément, pas un
caractère) ou deux `w:t` voisins ; « Jean-Pierre » avec un `<w:noBreakHyphen/>`
au lieu du `-` ; un IBAN avec des insécables. Chaque suite de blancs de la
valeur doit valoir une suite de blancs quelconque, et les éléments vides
(`w:tab`, `w:br`, `w:noBreakHyphen`) doivent figurer dans le texte cherché — et
être supprimés s'ils sont couverts. Dans `w:pPr`, `<w:tab w:pos=…/>` est un
**taquet**, pas du texte : ne pas l'y compter.

### W3. Les paragraphes s'imbriquent : une zone de texte contient des paragraphes

`w:txbxContent` vit dans un `w:r` d'un paragraphe, et Word l'écrit **deux fois**
(`mc:Choice` pour les Word récents, `mc:Fallback` en VML pour les anciens). Un
`w:t` appartient au paragraphe ouvert le plus INTÉRIEUR ; sans pile de
paragraphes, le texte de la zone se mélange à celui du paragraphe porteur. Les
deux copies sont à traiter : en oublier une laisse la valeur lisible dans le
fichier.

### W4. Le texte supprimé en suivi des modifications reste dans le fichier

`<w:delText>` : invisible une fois les révisions acceptées, intact dans le
XML. « Hélène Marchal » n'existe, dans la fiche, que là : `visible: false`,
`dansOctets: true`. Le même texte ne doit pas être mélangé au texte visible
(on ne cherche pas une valeur à cheval sur les deux), mais `extraireTexte` le
rend, pour que le détecteur le voie.

### W5. Les codes de champ et leurs attributs

`HYPERLINK "mailto:sophie.vanden` + `berghe@exemple.be"` : le code de champ
(`w:instrText`) est lui aussi réparti sur plusieurs runs. Le champ simple
(`w:fldSimple w:instr="…"`) porte le même code dans un **attribut**, guillemets
encodés en `&quot;`. Les deux sont traités ; le résultat reste
`HYPERLINK "mailto:[EMAIL_1]"`.

### W6. Les liens vivent dans `word/_rels/*.rels`

Le texte du lien est propre, la relation `Target="mailto:sophie…"` garde
l'adresse. Cible neutralisée en `about:blank`. Seules les cibles **externes**
(`TargetMode="External"`) : une cible interne (image, en-tête) est un chemin
dans l'archive. Le test garde un lien externe neutre pour le prouver.

### W7. Auteurs, texte alternatif, infobulles : des attributs, pas du texte

`w:author` et `w:initials` (révisions, commentaires), `w15:author` et
`w15:userId` (`people.xml`, où l'identifiant de compte peut être une adresse
e-mail), `descr`/`title`/`name` d'une image (le nom peut être celui du
fichier), `w:tooltip`. Les auteurs sont remplacés par « Auteur » **qu'une valeur
soit détectée ou non** (comme `nettoyerMetadonnees` pour le PDF) : « Claire
Hanssen » n'est que là. Les autres attributs ne sont touchés que s'ils sont
dans une liste connue : une valeur courte ne doit pas aller écraser un `w:val`,
un id ou un style.

### W8. Les métadonnées et la vignette

`docProps/core.xml` (auteur, dernier auteur, titre, sujet, mots-clés,
description, catégorie), `app.xml` (société, responsable), `custom.xml` :
vidés systématiquement. La vignette `docProps/thumbnail.*` est un aperçu de la
première page, en clair : supprimer l'entrée **et** sa relation dans
`_rels/.rels`, sinon la relation pointe dans le vide. Dans la fiche, un
commentaire JPEG y porte un nom ; `verifier` le trouve avant, plus après.

### W9. Une valeur dans deux paragraphes

« Rue de la Loi 16 » / « 1000 Bruxelles » : deux paragraphes, donc deux flux.
À défaut de trouver la valeur d'un bloc, on remplace chacune de ses lignes
d'au moins 3 caractères (le même jeton dans les deux). `verifier` fait le même
découpage : il signale aussi une ligne restée seule.

### W10. `&` et `<` : on décode pour chercher, on ré-encode pour écrire

« Dupont &amp; Fils SRL » se lit « Dupont & Fils SRL ». Chercher la valeur dans
le XML brut la rate ; ne ré-encoder que les segments modifiés laisse le reste
du fichier **octet pour octet** identique (testé sur les paragraphes neutres,
`styles.xml`, `settings.xml`, les images). `verifier` cherche les deux formes.

### W11. JSZip ajoute et modifie des choses si on ne l'en empêche pas

Mesuré : `zip.file("word/document.xml", …)` sur un .docx sans entrées de
dossier **ajoute une entrée `word/`** (`createFolders` vaut `true` par défaut) ;
et la date de l'entrée est remplacée par l'heure courante si on ne repasse pas
`date`. D'où `{ createFolders: false, date: ancienneDate }` à chaque écriture.
À l'inverse, les .docx produits par la bibliothèque `docx` **contiennent** des
entrées de dossier (`docProps/`, `_rels/`, `word/media/`) : on les conserve.
Les entrées gardent leur ordre, `[Content_Types].xml` reste en tête.

### W12. Ce qu'on ne sait pas faire, et qu'on doit dire

Texte DANS une image, objets OLE ou feuilles Excel incorporées
(`word/embeddings/`) : non analysés. `verifier` scanne les octets décompressés
de chaque entrée en UTF-8 **et en UTF-16LE** (les objets Office stockent leur
texte en UTF-16) et nomme l'objet (« image », « objet incorporé ») ;
`anonymiser` renvoie un avertissement (« 2 images : leur contenu n'est pas
analysé »). Un objet qui contient une valeur n'est pas modifié : la fuite est
signalée, pas corrigée.

### W13. Preuves de validité du fichier produit

Aucun contrôle ne remplace Word, mais trois lecteurs indépendants rouvrent le
résultat : `extraireTexte`, mammoth, et LibreOffice (conversion en PDF, dont le
texte est ensuite vérifié sans fuite). Le contrôle d'équilibrage des balises et
le décompte des paragraphes attrapent les erreurs d'édition avant eux. Un
`<w:r></w:r>` vide reste là où un `<w:tab/>` a été supprimé : valide.

---

## Licence du moteur

MuPDF.js est en **AGPL-3.0 ou licence commerciale**. Le dépôt étant en
AGPL-3.0, c'est compatible sans coût. Une version fermée ou un SaaS non publié
exigerait une licence commerciale auprès d'Artifex.
