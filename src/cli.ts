import { Database } from "bun:sqlite";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdirSync } from "fs";
import path from "path";

const ROOT = path.join(import.meta.dir, "..");
const DB_PATH = path.join(ROOT, "data", "v2", "db", "quran-layout.db");
const FONTS_DIR = path.join(ROOT, "data", "v2", "fonts");

const page = 3;
const width = 1440;

// Register font
const fontFamily = `p${page}`;
GlobalFonts.registerFromPath(path.join(FONTS_DIR, `p${page}.ttf`), fontFamily);

// Query all lines and glyphs for this page
const db = new Database(DB_PATH, { readonly: true });

const lines = db
  .query("SELECT line, type FROM mushaf_layout WHERE page = ? ORDER BY line")
  .all(page) as Array<{ line: number; type: string }>;

const glyphStmt = db.query(
  "SELECT position, text_qpc FROM mushaf_words WHERE page = ? AND line = ? ORDER BY position ASC"
);

// Measure canvas for sizing
const REF_SIZE = 100;
const mc = createCanvas(1, 1);
const mx = mc.getContext("2d");
mx.font = `${REF_SIZE}px "${fontFamily}"`;

// Measure all text lines to find the widest
let maxRefWidth = 0;
const lineData = lines.map((l) => {
  const glyphs = glyphStmt.all(page, l.line) as Array<{
    position: number;
    text_qpc: string;
  }>;

  const measured = glyphs.map((g) => ({
    ...g,
    w: mx.measureText(g.text_qpc).width,
  }));
  const total = measured.reduce((s, g) => s + g.w, 0);

  if (l.type === "text" && total > maxRefWidth) maxRefWidth = total;

  return { ...l, glyphs: measured, total };
});

db.close();

// Scale font so widest text line fits canvas width
const fontSize = Math.floor(REF_SIZE * (width / maxRefWidth));
mx.font = `${fontSize}px "${fontFamily}"`;

// Render each line
const outDir = path.join(ROOT, "output", "v2", "lines", String(width), String(page));
mkdirSync(outDir, { recursive: true });

for (const ld of lineData) {
  // Skip lines with no glyphs (surah headers without word data)
  if (ld.glyphs.length === 0) continue;

  // Re-measure at final size
  const glyphs = ld.glyphs.map((g) => ({
    ...g,
    w: mx.measureText(g.text_qpc).width,
  }));
  const total = glyphs.reduce((s, g) => s + g.w, 0);

  // Get max ascent/descent across all glyphs
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
    // Centered, natural spacing
    let x = (width + total) / 2;
    for (const g of glyphs) {
      x -= g.w;
      ctx.fillText(g.text_qpc, x, baseline);
    }
  } else {
    // Only justify if line fills most of the width
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
  console.log(`${ld.line}.png (${ld.type})`);
}

console.log(`done — ${lineData.filter((l) => l.glyphs.length > 0).length} lines`);
