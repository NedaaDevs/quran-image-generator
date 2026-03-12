import { Database } from "bun:sqlite";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdirSync } from "fs";
import path from "path";

const ROOT = path.join(import.meta.dir, "..");
const DB_PATH = path.join(ROOT, "data", "v2", "db", "quran-layout.db");
const FONTS_DIR = path.join(ROOT, "data", "v2", "fonts");

const page = 2;
const line = 3;
const width = 1440;

// Register font
const fontFamily = `p${page}`;
GlobalFonts.registerFromPath(path.join(FONTS_DIR, `p${page}.ttf`), fontFamily);

// Query glyphs
const db = new Database(DB_PATH, { readonly: true });
const glyphs = db
  .query("SELECT position, text_qpc FROM mushaf_words WHERE page = ? AND line = ? ORDER BY position DESC")
  .all(page, line) as Array<{ position: number; text_qpc: string }>;
db.close();

// Measure at reference size
const REF_SIZE = 100;
const mc = createCanvas(1, 1);
const mx = mc.getContext("2d");
mx.font = `${REF_SIZE}px "${fontFamily}"`;

const measured = glyphs.map((g) => ({
  ...g,
  w: mx.measureText(g.text_qpc).width,
}));
const refTotal = measured.reduce((s, g) => s + g.w, 0);

// Scale font so line fits canvas width
const fontSize = Math.floor(REF_SIZE * (width / refTotal));
mx.font = `${fontSize}px "${fontFamily}"`;

// Re-measure at final size
const final = measured.map((g) => ({
  ...g,
  w: mx.measureText(g.text_qpc).width,
}));
const total = final.reduce((s, g) => s + g.w, 0);

// Canvas height from max metrics across all glyphs
let ascent = 0;
let descent = 0;
for (const g of final) {
  const m = mx.measureText(g.text_qpc);
  ascent = Math.max(ascent, m.actualBoundingBoxAscent);
  descent = Math.max(descent, m.actualBoundingBoxDescent);
}
const pad = Math.ceil((ascent + descent) * 0.15);
const h = Math.ceil(ascent + descent) + pad * 2;

// Render
const canvas = createCanvas(width, h);
const ctx = canvas.getContext("2d");
ctx.font = `${fontSize}px "${fontFamily}"`;
ctx.fillStyle = "#000000";
ctx.textBaseline = "alphabetic";

const baseline = ascent + pad;
const gap = final.length > 1 ? (width - total) / (final.length - 1) : 0;
let x = width;

for (const g of final) {
  x -= g.w;
  ctx.fillText(g.text_qpc, x, baseline);
  x -= gap;
}

// Save
const outDir = path.join(ROOT, "output");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `p${page}_l${line}.png`);
await Bun.write(outPath, canvas.toBuffer("image/png"));
console.log(`wrote ${outPath}`);
