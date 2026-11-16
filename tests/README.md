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

**Règles de détection** (`js/regles.js`)

Partie pure (sans DOM), chargée telle quelle par le site et par Node. Aucun
`npm install`, aucun PDF :

```bash
cd tests
node regles.mjs          # couverture sur le corpus, faux positifs, cas unitaires
```

`corpus-regles.mjs` est un corpus **synthétique** belge FR/NL (10 documents,
103 valeurs sensibles repérées par `[[valeur|ÉTIQUETTE]]`). Le compte rendu
donne, par type de valeur, combien sont masquées **en entier**, **à moitié**
(le pire cas : une zone colorée donne l'impression d'avoir masqué) ou pas du
tout — avec les **réglages par défaut** de l'outil (montants et dates
ordinaires décochés, dates de naissance masquées) —, puis les faux positifs sur
des textes sans donnée personnelle, par défaut et tout coché. Le code
de sortie vaut 1 sous les seuils inscrits en tête de `regles.mjs` : on les
relève quand les règles progressent, jamais l'inverse.

> Ne jamais coller dans ce corpus un extrait d'un vrai document : le dépôt est
> **public**. Noms courants combinés au hasard, numéros d'exemple, domaines
> « exemple ».

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
un PDF coupe volontiers « Nadia\nCollard » en fin de ligne.

### 9. Une valeur anonymisée doit l'être PARTOUT

L'outil ne masquait que les occurrences *détectées*. Les règles les trouvent
toutes, mais l'IA en rate : sur un devis réel, « REVOLia » repéré **1 fois sur
17**, « Belgatech » 12 sur 16. La valeur restait lisible ailleurs. Les
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

« Monsieur Dupont » passe, « Camille Renard » non. Sur un devis réel de 13
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
soit détectée ou non** (comme `nettoyerMetadonnees` pour le PDF) : « Nadia
Collard » n'est que là. Les autres attributs ne sont touchés que s'ils sont
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

### Word : l'aperçu dans l'atelier

L'aperçu (`js/apercu-docx.js`) rend le .docx par docx-preview, hors écran, et
en tire un index de la forme de `pdfIndex`. Il faut un navigateur :
`node apercu-docx.cjs http://127.0.0.1:4599` (Playwright, déjà présent sur la
machine ; rien n'est installé dans le dépôt) fabrique un document de 5 pages
sans saut de page et en contrôle pagination et index. Constats mesurés :

### W14. docx-preview ne pagine que sur les sauts explicites

Un contrat de 14 articles sans saut de page devient UNE section de 8 079 px de
haut (7,2 pages A4 de 1 122,5 px) ; la version enregistrée par LibreOffice, une
section de 7 612 px. En vue « ajustée » (page entière visible) c'est illisible.
Les pages sont donc virtuelles : on coupe chaque section plus haute que
1,15 page (en dessous, c'est une page un peu haute : une police de
remplacement suffit à déborder de quelques lignes) en tranches, ENTRE deux
lignes. Chaque tranche reprend une marge haute (celle de la section) et laisse
la marge basse libre ; l'index est refait par tranche, en coordonnées
relatives à la fenêtre affichée. Mesuré : sur 9 pages virtuelles puis 20 pages
(64 000 caractères), aucun caractère n'est coupé par un bord de page. Les
en-têtes et pieds de page ne sont affichés qu'aux extrémités d'une section
découpée (le premier en haut de la première tranche, le second en bas de la
dernière).

### W15. Deux rangées de tableau voisines se touchent : aucun creux pour couper

Les creux entre lignes se déduisent des rectangles du texte, et une rangée
entière est un intervalle interdit. Sans rognage, deux rangées contiguës
fusionnent en un seul intervalle : la coupe cherchait un creux, n'en trouvait
pas, et tombait **au milieu de la rangée 10** (`paysage.docx`, 5 px de la rangée
visibles en bas d'une page, le reste en haut de la suivante). Rogner chaque
rangée de 1 px ouvre un creux de 2 px sur la frontière : la coupe y tombe. Les
rectangles de texte sont eux aussi rognés de 15 % : deux lignes à interligne
serré (< 0,7 em) ne fusionnent pas.

### W16. docx-preview rend un trait d'union insécable par un `<wbr>`

`<w:noBreakHyphen/>` donne `<span><wbr></span>` : le trait disparaît de
l'aperçu **et du texte lu** (« Monsieur JeanPierre Lambert »). La valeur
détectée ne se retrouvait plus dans le XML (« Jean-Pierre »), le jeton n'était
pas écrit, et la valeur restait lisible dans le résultat. C'est la vérification
du résultat (texte de l'aperçu du résultat + `AnonDocx.verifier`) qui l'a
attrapé, en bloquant le téléchargement. Corrigé à la source : chaque `<wbr>` est
remplacé par un `-` avant l'indexation. Même contrôle sur `fiche-word.docx` et
`contrat-synthetique.docx` : les seules lignes qui diffèrent entre le texte du
rendu et celui du XML sont les appels de note, le numéro de page, le texte
supprimé en suivi des modifications, les commentaires et le contenu d'un champ
simple (`w:fldSimple`) que docx-preview n'affiche pas.

### W17. Sans Shadow DOM, les styles du site déforment le document

Le même document, rendu sous les styles du site (`body` en Poppins avec un
interligne de 1,55, règles sur `p`, `hr`…), mesure 12 671 px au lieu de
8 079 px, dans une autre police. Isolé dans un Shadow DOM (conteneur de rendu
**et** pages affichées dans la scène, avec `:host{all:initial}`), le rendu
dans la page se superpose à celui d'une page vierge : sur `fiche-word.docx`, 1,1 %
des pixels diffèrent, tous sur les contours des glyphes (rééchantillonnage de la
capture à 622 px de large contre 794 px). Le CSS de la bibliothèque est
partagé entre toutes les pages par une feuille de style construite
(`adoptedStyleSheets`), et l'enveloppe grise, l'ombre et les marges
`.docx-wrapper` sont neutralisées : seule la feuille nous intéresse.

### W18. `nextPage` n'ouvre pas de section, et les orientations se mélangent

Dans `paysage.docx` (une section paysage suivie d'une section portrait),
docx-preview produit UNE seule `section.docx` de 3 378 px de haut, en paysage,
qui contient les deux contenus ; l'orientation suivante n'est pas honorée. Le
découpage en pages virtuelles s'y applique tel quel : 4 pages paysage puis la
page du saut explicite. Le fichier produit, lui, garde ses deux sections.

### W19. Temps mesurés

Document de 64 114 caractères (20 pages virtuelles) : rendu 51 ms, pagination
12 ms, index 336 ms ; le fil principal ne gèle jamais plus de 101 ms, parce que
le relevé d'un rectangle par caractère rend la main toutes les 25 ms (statut
« Lecture du texte et des positions… » affiché). Un document de 1 000
caractères : 4 ms.

### W20. Le résultat n'a pas toujours le même nombre de pages

Avec un terme très fréquent remplacé par `[TERME_1]` (« les »), un document de
9 pages en compte 10 une fois anonymisé. La page affichée en vue « Anonymisé »
est celle de même section et de même rang de tranche, bornée au dernier rang ;
quand les totaux diffèrent, l'étiquette indique « anonymisé · p. 9 / 10 ». Pas
de décalage silencieux, pas d'erreur.

### W21. Ce que l'aperçu ne montre pas, la détection ne le voit pas

La détection lit le texte du rendu : ni commentaires, ni texte supprimé en
suivi des modifications, ni contenu d'un `w:fldSimple`. Une valeur détectée
ailleurs y est remplacée quand même (le remplacement est global : vérifié sur
un commentaire de `fiche-word.docx`), mais un nom qui n'y figure que là reste.
Le bandeau de vérification le dit.

## Règles : les pièges

Mesurés sur le corpus de `regles.mjs` (47 valeurs sur 103 masquées en entier
avant les corrections, 80 après) ou sur un cas reproduit à la main. Plusieurs
échouent **sans bruit** : l'outil colore une zone, le document paraît traité,
et une partie de la donnée reste lisible.

### R1. `\b` ne voit que l'ASCII : « Liège » et « Genappé » sont coupés au mauvais endroit

Avec le drapeau `u`, `\b` considère `é` comme une non-lettre : `/Genappé\b/u`
ne reconnaît pas « Genappé 1 ». Les limites de mot s'écrivent
`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`. Même limite pour les **termes ajoutés
à la main** et pour la complétion des occurrences : sans elle, « Anne » devenait
`[TERME_1]xe` dans « annexe » et « Marc » `[TERME_2]hé` dans « marché ».
« REVOLia » reste reconnu dans « REVOLia.be » et dans une adresse e-mail :
le point et l'arobase ne sont pas des lettres.

### R2. Sous `iu`, `\p{Lu}` reconnaît aussi les minuscules

`/\p{Lu}/iu.test("a")` vaut `true` (`false` sans `i`). Les règles qui comptent
sur la majuscule (noms, rues, communes) s'écrivent donc **sans** `i`. À
l'inverse, `REFERENCE` a besoin de `i` pour ses mots-clés (« Dossier », « RÉF. »)
et le paie : sa valeur `[A-Z0-9]…` accepte alors « en-cours » dans « dossier
en-cours ». Le validateur exige un chiffre et aucune minuscule.

### R3. L'ordre des alternatives compte : `euros|EUR`, pas `EUR|euros`

Sous `i`, `(?:€|EUR|euros?)` reconnaît « EUR » au début de « euros » et laisse
« os » : `300 euros` donnait `[MONTANT_1]os`. L'alternative longue d'abord.

### R4. L'espace n'est pas un séparateur de date

Avec `[\/.\- ]` entre trois nombres, `+33 6 12 34 56 78` devenait **deux dates**
(`+[DATE_1] [DATE_2]`, texte illisible) et `+31 6 1234 5678` en laissait un
morceau lisible. Les dates entièrement numériques n'acceptent que `/ . -`. Le
même mécanisme prenait « 15 janvier. 4000 » pour une date : l'année doit
valoir 19xx, 20xx ou deux chiffres.

### R5. Un nom ou une commune composés se masquent à moitié

Une classe `[a-zà-ÿ'’\-]+` s'arrête au premier tiret ou à la première
majuscule : `M. Jean-Luc Dehaene` → seul `M. Jean-` masqué ; `Mme Van den
Broeck` → `Mme Van` ; `1200 Woluwe-Saint-Lambert` → `1200 Woluwe-`. Prénoms
composés, particules (`Van den`, `De`, `El`…) et chaînes à tirets sont décrits
explicitement. **Ne pas** mettre « le » / « la » parmi les particules :
« Madame la Présidente » et « Monsieur le Directeur » seraient pris pour des
noms.

### R6. Une commune suivie d'un espace, d'un mot en minuscule ou d'une majuscule avale la suite

Autoriser « espace + particule » après la commune donne `1000 Bruxelles le`
(dans « Fait à 1000 Bruxelles le 15 janvier ») et « espace + mot capitalisé »,
`4000 Liège Tél`. Seuls le tiret et l'apostrophe prolongent une commune
(`Louvain-la-Neuve`, `Braine-l'Alleud`), plus quelques préfixes avec espace
(`Sint Niklaas`, `Mont Saint-Guibert`).

Les évidences restent écartées à la main (`1382 Code`, `2023 Rapport`,
`2025 Wallonie`, un mois). Le reste se décide sur la liste officielle des codes
postaux (voir R21) : ne pas rejeter d'après le seul nombre, 1900 à 2099 sont
aussi des codes d'Anvers, de Zaventem, d'Overijse…

### R7. Un numéro de maison de quatre chiffres avale le code postal

`Avenue Louise, 1050 Ixelles` : un numéro `\d{1,4}` prend « 1050 », la rue
devient `Avenue Louise, 1050`, et `dedup` (le plus long qui commence en
premier) élimine le code postal : **« Ixelles » reste en clair**. Numéro de rue
limité à 3 chiffres et `(?!\d)`. Même idée pour le préfixe néerlandais d'une
rue (« Lange Kievitstraat ») : une liste d'adjectifs, pas « n'importe quel mot
capitalisé », sinon « Adres Kerkstraat 52 » est pris en entier.

### R8. Un validateur par clé évite les faux positifs, mais une coquille ne doit pas laisser passer la valeur

Sans validation, `12345678901` (une référence produit) était un n° national.
Avec la clé seule, un vrai numéro avec une faute de frappe échapperait. Le
motif est donc : clé juste (modulo 97, NISS avant et après 2000, BCE, IBAN),
**ou** un mot de contexte juste devant (`NISS`, `rijksregister`, `TVA`,
`ondernemingsnummer`, `IBAN`, `compte`, `rekening`…), **ou** le préfixe « BE »
pour un n° d'entreprise. Un IBAN invalide (`BE43 0682 4417 9301` dans le
corpus) n'est masqué qu'avec son mot de contexte.

### R9. Un motif gourmand avale un mot voisin ; le validateur peut raccourcir

`BE68 5390 0754 7034 ET voilà` : le motif IBAN prend « ET » (groupe de 1 à 3
caractères en capitales), le modulo 97 de l'ensemble échoue, et l'IBAN entier
serait rejeté. Un validateur peut renvoyer **un entier** — la longueur à
garder — ; on coupe à la longueur du pays (BE 16, FR 27, NL 18…) puis on
vérifie la clé.

### R10. Un terme désigné à la main ne passe pas par `EXCLUDE`

La liste d'exclusion (formes juridiques `srl`, `bvba`, `vzw`…, mais aussi
« directrice », « service ») sert à écarter les faux positifs des règles et de
l'IA. Appliquée à un terme que l'utilisateur vient de cliquer, elle faisait
disparaître sa demande sans un mot : « Directrice » cliqué sur un PDF ne
produisait rien. Les termes ajoutés y échappent.

### R11. Les jetons ne se renumérotent pas

Renuméroter à chaque recalcul faisait désigner à `[PERSONNE_1]` une autre
personne après avoir écarté une détection : une réponse d'IA déjà obtenue était
ré-identifiée avec le **mauvais nom**, sans avertissement. La table de session
(`catégorie::valeur normalisée → jeton`) vit jusqu'au changement de document ou
au bouton « Vider », ses compteurs n'avancent que, et la table exportée contient
**tous** les jetons attribués, y compris ceux de valeurs écartées depuis. Les
numéros peuvent donc sauter (`PERSONNE_1`, `PERSONNE_3`).

### R12. La ré-identification n'invente rien

Elle tolère `PERSONNE_1` sans crochets, `[ personne_1 ]` et le markdown
`\[PERSONNE\_1\]`, mais **seulement pour les jetons de la table** : `PERSONNE_12`
n'est pas `PERSONNE_1` suivi d'un 2, `rapport_1` n'est pas un jeton. Les jetons
de la forme `[XXX_n]` qui n'y figurent pas sont signalés, jamais devinés, tout
comme ceux de la table que la réponse ne contient pas.

### R13. Une date de naissance classée « Date » reste en clair

Depuis que `DATE` est décochée par défaut, la catégorie d'une date décide de
son sort. `DATE_NAISSANCE` et `DATE` partagent le même motif : à égalité de
position et de longueur, le dédoublonnage gardait la première arrivée, donc
l'ordre du tableau `CATS` et la stabilité du tri. `DATE_NAISSANCE` porte une
priorité propre (2,5, au-dessus des règles, sous les termes ajoutés) : le test
la met en concurrence avec `DATE` dans les deux ordres. La complétion des
occurrences recopie la catégorie : la même date ailleurs suit.

### R14. Le libellé d'un formulaire est sur sa ligne, la valeur dessous

Sur `fiche-reelle.pdf`, le texte extrait donne `Date de naissance\n03/07/1989` :
le contexte « date de naissance » ne franchissait pas le saut de ligne, et la
date de naissance restait **en clair** avec les nouveaux défauts (constaté dans
le navigateur, pas par le corpus, où libellé et valeur partagent la ligne). Un
seul saut de ligne est admis juste avant la date ; « Lieu de naissance\nGand\n
Engagé le 01/03/2025 » reste une date ordinaire.

### R15. Une puce électronique n'a pas de clé de contrôle

Quinze chiffres et un préfixe (code pays ISO 3166 ou fabricant 900–998) : c'est
tout. Les garde-fous sont donc ailleurs : pas de chiffre collé ni séparé d'une
espace avant ou après (une carte à 16 chiffres, un IBAN, un montant groupé
« 12 345 678 901 234 567 » ne s'y découpent pas), une carte American Express
(15 chiffres, Luhn juste) reste une carte, et après « réf. », « commande »,
« facture », « EAN »… c'est une référence — sauf si « puce » précède aussi.

### R16. L'expression des e-mails était quadratique

`[A-Za-z0-9._%+\-]+@…` : sur une suite de caractères admis dans une adresse
mais sans « @ » (un bloc base64 collé, une longue référence), le moteur
repart de **chaque** position et relit toute la suite. Mesuré : 186 ms pour
12 000 lettres, 1 212 ms pour 48 000 (×4 quand la longueur double) ; la forme
« x (at) exemple.org » avait le même défaut. Or toutes les positions d'une
même suite donnent le même résultat (la partie locale finit forcément au
premier caractère hors classe) : `rechercheParSuites` essaie chaque suite une
fois et confie la fin à une expression ancrée (`y`). Même interface qu'une
RegExp (`lastIndex`, `exec`), mêmes correspondances : le test compare à
l'expression d'origine sur 8 000 chaînes aléatoires et quelques cas tordus
(`x@y.com.z@w.org`, où la seconde adresse commence au milieu d'une suite).
Après : 48 000 caractères, toutes règles comprises, en 8 à 60 ms.

### R17. Deux autres boucles quadratiques, trouvées en chronométrant

- La **complétion des occurrences** testait chaque occurrence contre chaque
  détection : 244 ms pour un terme présent 12 000 fois dans 48 000 caractères
  (un terme fréquent, cf. W20). Sommes cumulées des caractères couverts :
  test en temps constant.
- Les **suggestions de noms** : un mot de 48 000 caractères à tirets
  (« Abc-Abc-… ») coûtait 427 ms, chaque morceau relisant la suite. Un nom n'a
  jamais plus de quatre tirets ou apostrophes : la répétition est bornée.

Le test P de `regles.mjs` passe 14 entrées pathologiques de 48 000 caractères
(chiffres, majuscules, tirets, base64, mots capitalisés, « (at) » répété…)
dans toute la chaîne — détection, complétion, suggestions, ré-identification —
et échoue au-delà de 250 ms par entrée.

### R18. La clé interne d'une catégorie n'est pas un bon nom de jeton

`[CP_VILLE_1]`, `[TVA_BE_1]` : l'IA et le lecteur comprenaient mal. Chaque
catégorie a désormais un **nom de jeton** distinct de sa clé (`LOCALITE`,
`N_ENTREPRISE`, `N_NATIONAL`, `ADRESSE`, `TELEPHONE`…), et la table de
session compte **par nom de jeton** : un terme typé Personne et une personne
détectée tirent leurs numéros du même compteur. Compter par catégorie aurait
donné `[PERSONNE_1]` à « Nadia Collard » (catégorie TERME) alors que
« Sophie Vandenberghe » (catégorie PERSONNE) l'avait déjà. Les anciennes
tables restent lisibles : la ré-identification ne dépend que du texte du
jeton, et les anciens noms comptent parmi les catégories connues (un
`[CP_VILLE_2]` absent de la table est signalé).

### R19. Une partie de nom est souvent celle d'un AUTRE nom

« Aïcha Benali » masquée, le courrier du corpus dit « Son mari, Youssef
Benali ». Proposer « Benali » comme partie d'Aïcha, avec son jeton, aurait
donné « Youssef [PERSONNE_2] », ré-identifié en « Youssef Aïcha Benali ». Même
chose pour « Kris Janssens » face à « Dr Pieter Janssens ». Une partie collée à
un autre mot capitalisé ou à une particule n'est donc pas une partie (sauf
formule d'appel, titre, enseigne : « Beste Pieter », « Cabinet Janssens ») ;
et le jeton de la personne n'est repris que si le terme accepté — qui se
masque partout, sans tenir compte de la casse — ne touche rien d'autre que les
occurrences comptées. Sinon : jeton propre. Un jeton reste lié à UNE valeur :
la table garde `[PERSONNE_1] → Nathalie Mertens`, « N. Mertens » n'y est qu'un
alias. Mesuré sur le corpus : 4 des 23 valeurs ratées deviennent des
suggestions de parties (« N. Mertens », « Janssens », « Thomas », « Pieter »),
aucune proposition parasite ; avec les noms complets, 19 sur 23 sont proposées.

Second piège, constaté au premier essai : la même personne a deux adresses
dans l'e-mail RH du corpus (`thomas.mathieu@…` et `thomas.mathieu (at) …`).
« Thomas » était compté deux fois (« Thomas ×2 » pour une seule occurrence).
On compte par position.

### R20. Le format néerlandais avalait le code et laissait la ville

`1012 AB Amsterdam` : le motif prenait « AB » pour la commune (un mot en
capitales) et laissait « Amsterdam » en clair. Le motif connaît maintenant la
forme `1234 AB Plaats`, qui ne passe pas par la liste belge.

### R21. Valider sur la liste, oui ; exiger le bon couple, non

Liste : BeST Address (SPF BOSA), CC BY 4.0, 1 143 codes et 4 047 noms après
fusion des casses. La liste bpost, elle, ne porte aucune licence de
réutilisation (« Copyright © bpost ») : pas embarquée. Exiger que la localité
corresponde au code aurait fait échouer un test existant, `9000 Sint
Niklaas` (Sint-Niklaas est 9100) : une adresse fausse reste une adresse. La
liste sert donc à REFUSER un code inexistant suivi d'une localité belge
(`2024 Bruxelles`, `2019 Liège`) ou qui ressemble à une année. Les exonymes
y sont (« Gand », « Anvers », « Luik ») grâce aux colonnes `city_fr`/`city_de`
des fichiers flamands et wallons. Les codes « spéciaux » de bpost (grandes
organisations, sans rue) n'y sont pas : `1031 Bruxelles` serait refusé.

### Ce que les règles ne font pas encore

Noms **sans titre** (« Marc Wauters », « Julie ») et raisons sociales
(« Boulangerie Dewolf ») : 23 des 103 valeurs, presque toutes. Ce sont des
suggestions à valider d'un clic, jamais un masquage d'office : « Haute École »
ou « Cher Confrère » en font partie. « Julie » seule, sans nom masqué dont elle
serait la partie, n'est pas proposée. Villes seules (« Gand », « Brugge ») et
n° de mutuelle hors mot-clé échappent aussi.

---

## OCR : `fra` suffit sur nos mesures, `fra+nld` coûte du temps

Mesuré (Tesseract.js, même source `tessdata.projectnaptha.com/4.0.0/`, `fra`
6,3 Mo, `nld` 10,2 Mo compressés) sur deux pages synthétiques, une française et
une flamande (24 valeurs sensibles chacune : noms à particule, rues en
« -straat », IBAN, e-mail…), à trois niveaux de dégradation (propre, flou +
JPEG 50, flou + inclinaison + JPEG 30). Valeurs lues en entier, médiane de 3
passes :

| scan, qualité | `fra` | `fra+nld` | temps `fra` → `fra+nld` |
|---|---|---|---|
| nl propre | 23/24 | 22/24 | 438 → 537 ms |
| nl moyen | 23/24 | 23/24 | 335 → 483 ms |
| nl dégradé | 13/24 | 15/24 | 262 → 494 ms |
| fr propre | 24/24 | 24/24 | 423 → 466 ms |
| fr moyen | 24/24 | 24/24 | 323 → 395 ms |
| fr dégradé | 21/24 | 20/24 | 264 → 480 ms |

Le gain sur le flamand est dans le bruit (`nld` seul : 22, 23, 14) alors que le
temps monte de 10 à 90 % : noms, adresses et numéros se lisent pareil dans les
deux langues, le facteur limitant est la qualité de l'image. `nld` corrige
surtout les mots courants (« Wijksregisternummer » lu pour « Rijksregister… »),
utiles quand ils servent de mot de contexte à une règle. D'où : `fra` par
défaut, néerlandais au choix dans le bandeau du document.

Piège : un hébergeur peut répondre **200 + page HTML** pour un fichier absent ;
`langueInstallee()` regarde donc aussi le type de contenu avant de charger.

## Licence du moteur

MuPDF.js est en **AGPL-3.0 ou licence commerciale**. Le dépôt étant en
AGPL-3.0, c'est compatible sans coût. Une version fermée ou un SaaS non publié
exigerait une licence commerciale auprès d'Artifex.
