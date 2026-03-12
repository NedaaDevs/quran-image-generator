import { mkdirSync } from "fs";
import path from "path";
import { createDb } from "./database";
import { registerPageFont } from "./font-loader";
import { measurePage, renderLine } from "./renderer";

const ROOT = path.join(import.meta.dir, "..");
const DB_PATH = path.join(ROOT, "data", "v2", "db", "quran-layout.db");
const FONTS_DIR = path.join(ROOT, "data", "v2", "fonts");

const startPage = Number(process.argv[2]) || 1;
const endPage = Number(process.argv[3]) || startPage;
const width = Number(process.argv[4]) || 1440;

if (startPage < 1 || endPage > 604 || startPage > endPage) {
  console.error("Usage: bun src/cli.ts [startPage] [endPage] [width]");
  console.error("  Pages: 1-604, width default: 1440");
  process.exit(1);
}

const db = createDb(DB_PATH);

const renderPage = async (page: number) => {
  const fontFamily = registerPageFont(FONTS_DIR, page);
  const lines = db.getPageLines(page);

  const lineInputs = lines.map((l) => ({
    ...l,
    glyphs: db.getLineGlyphs(page, l.line),
  }));

  const { lineData, fontSize } = measurePage(fontFamily, lineInputs, width);

  const outDir = path.join(ROOT, "output", "v2", "lines", String(width), String(page));
  mkdirSync(outDir, { recursive: true });

  let rendered = 0;
  for (const ld of lineData) {
    if (ld.glyphs.length === 0) continue;

    const buffer = renderLine(fontFamily, fontSize, width, ld);
    await Bun.write(path.join(outDir, `${ld.line}.png`), buffer);
    rendered++;
  }

  return rendered;
};

console.log(`Rendering pages ${startPage}-${endPage} at ${width}px width...\n`);

let totalLines = 0;
for (let page = startPage; page <= endPage; page++) {
  const count = await renderPage(page);
  totalLines += count;
  process.stdout.write(`\r  page ${page}/${endPage} (${count} lines)`);
}

db.close();
console.log(`\n\nDone — ${totalLines} lines across ${endPage - startPage + 1} pages`);
