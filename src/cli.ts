import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdirSync } from "fs";
import path from "path";
import { createDb } from "./database";

const ROOT = path.join(import.meta.dir, "..");
const DB_PATH = path.join(ROOT, "data", "v2", "db", "quran-layout.db");
const FONTS_DIR = path.join(ROOT, "data", "v2", "fonts");

// Parse args: bun src/cli.ts [startPage] [endPage] [width]
const startPage = Number(process.argv[2]) || 1;
const endPage = Number(process.argv[3]) || startPage;
const width = Number(process.argv[4]) || 1440;

if (startPage < 1 || endPage > 604 || startPage > endPage) {
  console.error("Usage: bun src/cli.ts [startPage] [endPage] [width]");
  console.error("  Pages: 1-604, width default: 1440");
  process.exit(1);
}

const db = createDb(DB_PATH);

const REF_SIZE = 100;
const mc = createCanvas(1, 1);
const mx = mc.getContext("2d");

const renderPage = async (page: number) => {
  const fontFamily = `p${page}`;
  GlobalFonts.registerFromPath(
    path.join(FONTS_DIR, `p${page}.ttf`),
    fontFamily
  );

  const lines = db.getPageLines(page);

  // Measure all text lines at reference size to find the widest
  mx.font = `${REF_SIZE}px "${fontFamily}"`;
  let maxRefWidth = 0;
  const lineData = lines.map((l) => {
    const glyphs = db.getLineGlyphs(page, l.line);
    const measured = glyphs.map((g) => ({
      ...g,
      w: mx.measureText(g.text_qpc).width,
    }));
    const total = measured.reduce((s, g) => s + g.w, 0);
    if (l.type === "text" && total > maxRefWidth) maxRefWidth = total;
    return { ...l, glyphs: measured, total };
  });

  // Scale font so widest text line fits canvas width
  const fontSize = Math.floor(REF_SIZE * (width / maxRefWidth));
  mx.font = `${fontSize}px "${fontFamily}"`;

  const outDir = path.join(
    ROOT,
    "output",
    "v2",
    "lines",
    String(width),
    String(page)
  );
  mkdirSync(outDir, { recursive: true });

  let rendered = 0;
  for (const ld of lineData) {
    if (ld.glyphs.length === 0) continue;

    // Re-measure at final size
    const glyphs = ld.glyphs.map((g) => ({
      ...g,
      w: mx.measureText(g.text_qpc).width,
    }));
    const total = glyphs.reduce((s, g) => s + g.w, 0);

    // Max ascent/descent across all glyphs
    let ascent = 0;
    let descent = 0;
    for (const g of glyphs) {
      const m = mx.measureText(g.text_qpc);
      ascent = Math.max(ascent, m.actualBoundingBoxAscent);
      descent = Math.max(descent, m.actualBoundingBoxDescent);
    }

    const pad = Math.ceil((ascent + descent) * 0.15);
    const h = Math.ceil(ascent + descent) + pad * 2;

    const canvas = createCanvas(width, h);
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "alphabetic";

    const baseline = ascent + pad;
    const isSpecial = ld.type === "surah-header" || ld.type === "basmala";

    if (isSpecial) {
      let x = (width + total) / 2;
      for (const g of glyphs) {
        x -= g.w;
        ctx.fillText(g.text_qpc, x, baseline);
      }
    } else {
      const fillRatio = total / width;
      const gap =
        fillRatio > 0.7 && glyphs.length > 1
          ? (width - total) / (glyphs.length - 1)
          : 0;
      let x = width;
      for (const g of glyphs) {
        x -= g.w;
        ctx.fillText(g.text_qpc, x, baseline);
        x -= gap;
      }
    }

    const outPath = path.join(outDir, `${ld.line}.png`);
    await Bun.write(outPath, canvas.toBuffer("image/png"));
    rendered++;
  }

  return rendered;
};

console.log(
  `Rendering pages ${startPage}-${endPage} at ${width}px width...\n`
);

let totalLines = 0;
for (let page = startPage; page <= endPage; page++) {
  const count = await renderPage(page);
  totalLines += count;
  process.stdout.write(`\r  page ${page}/${endPage} (${count} lines)`);
}

db.close();
console.log(
  `\n\nDone — ${totalLines} lines across ${endPage - startPage + 1} pages`
);
