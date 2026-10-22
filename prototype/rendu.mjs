// Rend chaque PDF passé en argument en PNG, pour comparaison visuelle.
import * as mupdf from "mupdf";
import { readFileSync, writeFileSync } from "node:fs";

for (const f of process.argv.slice(2)) {
  const doc = mupdf.PDFDocument.openDocument(readFileSync(f), "application/pdf");
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true);
  const out = f.replace(/\.pdf$/, ".png");
  writeFileSync(out, pix.asPNG());
  console.log(out, pix.getWidth() + "×" + pix.getHeight());
}
