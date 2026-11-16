/* Fabrique un .docx de test 100 % SYNTHÉTIQUE (aucune donnée réelle), en XML
   brut + JSZip, qui réunit les cas où une valeur se cache dans un fichier Word.
   Chaque cas porte un piège mesuré — voir tests/README.md, « Word : les pièges ».

   Usage : node fabrique-docx.mjs        → écrit tests/fiche-word.docx
   Importable : { construire, SENSIBLES, NEUTRES, MULTILIGNE } */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const JSZip = createRequire(import.meta.url)("../vendor/jszip.min.js");

/* Tout ce qui doit avoir disparu du fichier produit, partout. */
export const MULTILIGNE = "Rue de la Loi 16\n1000 Bruxelles";
export const SENSIBLES = [
  "Sophie Vandenberghe", "Vandenberghe", "sophie.vandenberghe@exemple.be",
  "BE68 5390 0754 7034", "Jean-Pierre Lambert", "Dupont & Fils SRL", "Belgatech SRL",
  "Hélène Marchal",    // uniquement dans un texte supprimé en suivi des modifications
  "Nadia Collard",    // uniquement auteur de révision/commentaire et métadonnée
  "Paul Delvaux",      // uniquement métadonnée (Manager, description)
  MULTILIGNE,
];
/* Paragraphes sans donnée sensible : doivent rester identiques octet pour octet. */
export const NEUTRES = ["NEUTRE-1", "NEUTRE-2", "NEUTRE-3", "NEUTRE-4"];

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
const ENTETE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const t = (s) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const p = (...runs) => `<w:p>${runs.join("")}</w:p>`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// Fausse vignette JPEG : un commentaire JPEG y porte un nom, comme un aperçu réel porterait la page 1.
const COM = Buffer.from("Vignette synthetique de Sophie Vandenberghe");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0, COM.length + 2]), COM,
  Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64").subarray(2)]);

function documentXml() {
  const boite = (idDocPr) =>
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="3600000" cy="500000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>` +
    `<wp:docPr id="${idDocPr}" name="Zone de texte ${idDocPr}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3600000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>` +
    `<wps:txbx><w:txbxContent>${p(t("Zone de texte : Sophie "), t("Vandenberghe"))}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>` +
    `</wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict>` +
    `<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>` +
    `<v:shape id="Zone${idDocPr}" o:spid="_x0000_s${1024 + idDocPr}" type="#_x0000_t202" style="position:absolute;width:283pt;height:40pt">` +
    `<v:textbox><w:txbxContent>${p(t("Zone de texte : Sophie "), t("Vandenberghe"))}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

  const image =
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="360000" cy="360000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="1" name="Photo Sophie Vandenberghe" descr="Photo de Sophie Vandenberghe" title="Sophie Vandenberghe"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr>` +
    `<pic:cNvPr id="0" name="portrait.png" descr="Portrait de Sophie Vandenberghe"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="360000" cy="360000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

  const corps = [
    p('<w:pPr><w:pStyle w:val="Titre1"/></w:pPr>', t("Fiche de test synthétique")),
    // piège : texte neutre avec accents, apostrophe et mise en forme : doit rester identique
    p('<w:pPr><w:jc w:val="both"/></w:pPr>', '<w:r><w:rPr><w:i/></w:rPr><w:t>NEUTRE-1 : ce paragraphe ne contient aucune donnée sensible (é, è, à, ç, d\'usage).</w:t></w:r>'),
    // valeur coupée en 3 runs, avec correcteur orthographique et signet au milieu
    p(t("Madame Sophie Vanden"), '<w:proofErr w:type="spellStart"/>', '<w:r><w:rPr><w:b/></w:rPr><w:t>ber</w:t></w:r>',
      '<w:proofErr w:type="spellEnd"/><w:bookmarkStart w:id="50" w:name="signet_nom"/>', t("ghe, domiciliée à Namur."), '<w:bookmarkEnd w:id="50"/>'),
    // espace insécable (U+00A0) dans la valeur
    p(t("Contact : Sophie Vandenberghe (espace insécable).")),
    // tabulation entre le prénom et le nom
    p(t("Madame Sophie"), "<w:r><w:tab/></w:r>", t("Vandenberghe (tabulation).")),
    // trait d'union insécable
    p(t("Monsieur Jean"), "<w:r><w:noBreakHyphen/></w:r>", t("Pierre Lambert est le témoin.")),
    // valeur incluse dans une plus longue : seul le nom de famille
    p(t("Monsieur Vandenberghe reste joignable.")),
    // lien de relation (mailto externe) + infobulle
    p(t("Courriel : "), '<w:hyperlink r:id="rId7" w:tooltip="Écrire à Sophie Vandenberghe" w:history="1">', t("sophie.vandenberghe@exemple.be"), "</w:hyperlink>"),
    // code de champ HYPERLINK réparti sur deux runs
    p('<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:sophie.vanden</w:instrText></w:r>',
      '<w:r><w:instrText xml:space="preserve">berghe@exemple.be" </w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>', t("Écrire par courriel"), '<w:r><w:fldChar w:fldCharType="end"/></w:r>'),
    // champ simple : le code est dans un attribut
    p('<w:fldSimple w:instr=" HYPERLINK &quot;mailto:sophie.vandenberghe@exemple.be&quot; ">', t("Second lien"), "</w:fldSimple>"),
    // IBAN avec espaces ordinaires puis insécables
    p(t("IBAN : BE68 5390 0754 7034 et BE68 5390 0754 7034.")),
    // entités XML dans une valeur
    p(t("Facture de Dupont &amp; Fils SRL pour Belgatech SRL.")),
    // entités XML dans du texte neutre : doit rester identique
    p(t("NEUTRE-2 : seuil &lt; cinq cents &amp; TVA incluse, symbole €, balise littérale &lt;w:t&gt; et guillemets &quot;droits&quot;.")),
    // valeur sur deux lignes (deux paragraphes)
    p(t("Rue de la Loi 16")), p(t("1000 Bruxelles")),
    // tableau
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(t("NEUTRE-3 Bénéficiaire"))}</w:tc><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${p(t("Sophie Vandenberghe"))}</w:tc></w:tr>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(t("Ville"))}</w:tc><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${p(t("Namur"))}</w:tc></w:tr></w:tbl>`,
    // suivi des modifications : le texte supprimé RESTE dans le fichier
    p(t("Avant révision : "),
      '<w:del w:id="101" w:author="Nadia Collard" w:date="2026-05-02T10:00:00Z"><w:r><w:delText xml:space="preserve">Madame Hélène Marchal</w:delText></w:r></w:del>',
      '<w:ins w:id="102" w:author="Nadia Collard" w:date="2026-05-02T10:00:00Z"><w:r><w:t>la bénéficiaire</w:t></w:r></w:ins>'),
    // zone de texte, en double (Choice + Fallback)
    p(boite(2)),
    // image avec texte alternatif, commentaire et note de bas de page
    p(image, t(" NEUTRE-4 légende. "),
      '<w:commentRangeStart w:id="0"/>', t("Passage commenté."), '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
      '<w:commentRangeStart w:id="1"/>', t(" Autre passage."), '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>',
      '<w:r><w:footnoteReference w:id="1"/></w:r>'),
    '<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
  ];
  return ENTETE + `<w:document ${NS} mc:Ignorable="w15"><w:body>${corps.join("")}</w:body></w:document>`;
}

const REL = (id, type, cible, ext) =>
  `<Relationship Id="${id}" Type="${type}" Target="${cible}"${ext ? ' TargetMode="External"' : ""}/>`;
const T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

export async function construire() {
  const zip = new JSZip();
  const date = new Date("2026-01-01T00:00:00Z");           // reproductible
  const ajouter = (nom, contenu) => zip.file(nom, contenu, { date, createFolders: false });

  ajouter("[Content_Types].xml", ENTETE +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
    '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
    '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>' +
    '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>');

  ajouter("_rels/.rels", ENTETE + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    REL("rId1", T + "officeDocument", "word/document.xml") +
    REL("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml") +
    REL("rId3", T + "extended-properties", "docProps/app.xml") +
    REL("rId4", T + "custom-properties", "docProps/custom.xml") +
    REL("rId5", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail", "docProps/thumbnail.jpeg") +
    "</Relationships>");

  ajouter("docProps/core.xml", ENTETE +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>Fiche Sophie Vandenberghe</dc:title><dc:subject>Dossier Jean-Pierre Lambert</dc:subject><dc:creator>Sophie Vandenberghe</dc:creator>" +
    "<cp:keywords>Belgatech</cp:keywords><dc:description>Note de Paul Delvaux</dc:description><cp:lastModifiedBy>Nadia Collard</cp:lastModifiedBy>" +
    "<cp:category>Confidentiel</cp:category>" +
    '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-02T00:00:00Z</dcterms:modified></cp:coreProperties>');
  ajouter("docProps/app.xml", ENTETE +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application>' +
    "<Company>Belgatech SRL</Company><Manager>Paul Delvaux</Manager><Pages>1</Pages></Properties>");
  ajouter("docProps/custom.xml", ENTETE +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Client"><vt:lpwstr>Sophie Vandenberghe</vt:lpwstr></property></Properties>');
  ajouter("docProps/thumbnail.jpeg", JPEG);

  ajouter("customXml/item1.xml", ENTETE + "<dossier><client>Sophie Vandenberghe</client><reference>NEUTRE-REF</reference></dossier>");
  ajouter("customXml/itemProps1.xml", ENTETE + '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{11111111-2222-3333-4444-555555555555}"><ds:schemaRefs/></ds:datastoreItem>');
  ajouter("customXml/_rels/item1.xml.rels", ENTETE + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    REL("rId1", T + "customXmlProps", "itemProps1.xml") + "</Relationships>");

  ajouter("word/document.xml", documentXml());
  ajouter("word/_rels/document.xml.rels", ENTETE + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    REL("rId1", T + "styles", "styles.xml") + REL("rId2", T + "settings", "settings.xml") +
    REL("rId3", T + "header", "header1.xml") + REL("rId4", T + "footer", "footer1.xml") +
    REL("rId5", T + "footnotes", "footnotes.xml") + REL("rId6", T + "comments", "comments.xml") +
    REL("rId7", T + "hyperlink", "mailto:sophie.vandenberghe@exemple.be", true) +
    REL("rId8", "http://schemas.microsoft.com/office/2011/relationships/people", "people.xml") +
    REL("rId9", T + "image", "media/image1.png") +
    REL("rId10", T + "hyperlink", "https://www.exemple.be/accueil", true) +       // lien neutre : doit rester
    REL("rId11", T + "customXml", "../customXml/item1.xml") + "</Relationships>");
  ajouter("word/media/image1.png", PNG);

  ajouter("word/styles.xml", ENTETE + `<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>');
  ajouter("word/settings.xml", ENTETE + `<w:settings ${NS}><w:zoom w:percent="100"/></w:settings>`);
  ajouter("word/header1.xml", ENTETE + `<w:hdr ${NS}>${p(t("Sophie "), t("Vandenberghe — fiche confidentielle"))}</w:hdr>`);
  ajouter("word/footer1.xml", ENTETE + `<w:ftr ${NS}>${p(t("Contact : sophie.vandenberghe@exemple.be — page "), '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>')}</w:ftr>`);
  ajouter("word/footnotes.xml", ENTETE + `<w:footnotes ${NS}>` +
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    `<w:footnote w:id="1">${p(t("Note : joindre la fiche de Sophie Vandenberghe au dossier."))}</w:footnote></w:footnotes>`);
  ajouter("word/comments.xml", ENTETE + `<w:comments ${NS}>` +
    `<w:comment w:id="0" w:author="Sophie Vandenberghe" w:date="2026-05-02T10:00:00Z" w:initials="SV">${p(t("À vérifier avec Madame Sophie Vandenberghe."))}</w:comment>` +
    `<w:comment w:id="1" w:author="Nadia Collard" w:date="2026-05-03T10:00:00Z" w:initials="NC">${p(t("NEUTRE-5 : d'accord."))}</w:comment></w:comments>`);
  ajouter("word/people.xml", ENTETE + `<w15:people ${NS}>` +
    '<w15:person w15:author="Sophie Vandenberghe"><w15:presenceInfo w15:providerId="Windows Live" w15:userId="sophie.vandenberghe@exemple.be"/></w15:person>' +
    '<w15:person w15:author="Nadia Collard"><w15:presenceInfo w15:providerId="None" w15:userId="Nadia Collard"/></w15:person></w15:people>');

  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sortie = fileURLToPath(new URL("./fiche-word.docx", import.meta.url));
  const octets = await construire();
  writeFileSync(sortie, octets);
  console.log(`écrit ${sortie} (${octets.length} octets)`);
}
