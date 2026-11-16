/* Second document de test, produit par une VRAIE bibliothèque (docx, celle du
   site pour l'export) plutôt qu'écrit à la main : sa structure XML est celle
   d'un générateur réel (styles, numérotation, propriétés, relations), pas celle
   qu'on aurait imaginée. Contenu 100 % synthétique.

   Usage : node fabrique-docx-lib.cjs   → écrit tests/contrat-synthetique.docx */
const d = require("../vendor/docx.umd.js");
const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType,
        Header, Footer, ExternalHyperlink, FootnoteReferenceRun, CommentRangeStart, CommentRangeEnd, CommentReference,
        InsertedTextRun, DeletedTextRun, PageNumber, ImageRun } = d;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const cellule = (txt) => new TableCell({ children: [new Paragraph(txt)] });

const doc = new Document({
  creator: "Sophie Vandenberghe", lastModifiedBy: "Nadia Collard", title: "Contrat Belgatech", description: "Dossier de Sophie Vandenberghe",
  comments: { children: [{ id: 0, author: "Nadia Collard", initials: "NC", date: new Date("2026-05-02T10:00:00Z"),
    children: [new Paragraph({ children: [new TextRun("À relire avec Madame Sophie Vandenberghe.")] })] }] },
  footnotes: { 1: { children: [new Paragraph("Voir la fiche de Sophie Vandenberghe, IBAN BE68 5390 0754 7034.")] } },
  sections: [{
    headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun("Contrat — "), new TextRun({ text: "Belgatech SRL", bold: true })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun("sophie.vandenberghe@exemple.be — page "), new TextRun({ children: [PageNumber.CURRENT] })] })] }) },
    children: [
      new Paragraph({ text: "Contrat de prestation", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun("Entre "), new TextRun({ text: "Madame Sophie ", bold: true }), new TextRun({ text: "Vandenberghe", bold: true, italics: true }),
        new TextRun(", domiciliée Rue de la Loi 16, 1000 Bruxelles, e-mail "),
        new ExternalHyperlink({ link: "mailto:sophie.vandenberghe@exemple.be", children: [new TextRun({ text: "sophie.vandenberghe@exemple.be", style: "Hyperlink" })] }),
        new TextRun(", téléphone +32 475 12 34 56,")] }),
      new Paragraph({ children: [new TextRun("et la société Belgatech SRL (TVA BE 0123.456.749), IBAN BE68 5390 0754 7034."),
        new FootnoteReferenceRun(1)] }),
      new Paragraph({ text: "Article 1 — Objet", heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [
        new CommentRangeStart(0), new TextRun("Le présent contrat a pour objet la formation à l'intelligence artificielle dispensée le 11 juin 2026 pour un montant de 1 250,00 € hors TVA. "),
        new CommentRangeEnd(0), new TextRun({ children: [new CommentReference(0)] }),
        new TextRun("Madame Sophie Vandenberghe s'engage à régler la facture dans les trente jours.")] }),
      new Paragraph({ children: [new TextRun("Révision : "),
        new DeletedTextRun({ text: "Monsieur Jean-Pierre Lambert", id: 1, author: "Nadia Collard", date: "2026-05-02T10:00:00Z" }),
        new InsertedTextRun({ text: "le prestataire", id: 2, author: "Nadia Collard", date: "2026-05-02T10:00:00Z" })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ children: [cellule("Prestation"), cellule("Date"), cellule("Montant")] }),
        new TableRow({ children: [cellule("Atelier IA"), cellule("11/06/2026"), cellule("1 250,00 €")] }),
      ] }),
      new Paragraph({ children: [new ImageRun({ type: "png", data: PNG, transformation: { width: 40, height: 40 },
        altText: { name: "Signature", description: "Signature de Sophie Vandenberghe", title: "Sophie Vandenberghe" } })] }),
      new Paragraph({ text: "Fait à Namur, le 2 juin 2026." }),
    ],
  }],
});
Packer.toBuffer(doc).then(b => {
  const sortie = path.join(__dirname, "contrat-synthetique.docx");
  fs.writeFileSync(sortie, b); console.log("écrit", sortie, b.length, "octets");
});
