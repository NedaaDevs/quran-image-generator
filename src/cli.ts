import { mkdirSync } from "fs";
import path from "path";
import { createDb } from "./database";
import { registerPageFont } from "./font-loader";
import { measurePage, renderLine, renderFullPage } from "./renderer";
import { FontVersion, RenderMode } from "./types";

const ROOT = path.join(import.meta.dir, "..");

const version = process.argv.includes("v2") ? FontVersion.V2 : FontVersion.V1;
const DB_PATH = path.join(ROOT, "data", version, "db", "quran-layout.db");
const FONTS_DIR = path.join(ROOT, "data", version, "fonts");

const startPage = Number(process.argv[2]) || 1;
const endPage = Number(process.argv[3]) || startPage;
const width = Number(process.argv[4]) || 1440;
const mode = process.argv[5] === "page" ? RenderMode.Page : RenderMode.Line;
const withMarkers = process.argv.includes("markers");

if (startPage < 1 || endPage > 604 || startPage > endPage) {
  console.error("Usage: bun src/cli.ts [startPage] [endPage] [width] [mode] [markers] [v1|v2]");
  console.error("  Pages: 1-604, width default: 1440, mode: line|page, font: v1|v2 (default v2)");
  process.exit(1);
}

const db = createDb(DB_PATH);

const renderPage = async (page: number) => {
  const fontFamily = registerPageFont(FONTS_DIR, page, version);
  const lines = db.getPageLines(page);

  const lineInputs = lines.map((l) => ({
    ...l,
    glyphs: db.getLineGlyphs(page, l.line, true),
  }));

  if (mode === RenderMode.Page) {
    const buffer = renderFullPage(fontFamily, lineInputs, width, page, withMarkers);
    const outDir = path.join(ROOT, "output", version, "pages", String(width));
    mkdirSync(outDir, { recursive: true });
    await Bun.write(path.join(outDir, `${page}.png`), buffer);
    return 1;
  }

  const { lineData, fontSize, lineHeight, ascent, descent, hPad } = measurePage(fontFamily, lineInputs, width);

  const outDir = path.join(ROOT, "output", version, "lines", String(width), String(page));
  mkdirSync(outDir, { recursive: true });

  let rendered = 0;
  for (const ld of lineData) {
    if (ld.glyphs.length === 0) continue;

    const buffer = renderLine(fontFamily, fontSize, width, { lineHeight, ascent, descent, hPad }, ld, withMarkers);
    await Bun.write(path.join(outDir, `${ld.line}.png`), buffer);
    rendered++;
  }

  return rendered;
};

console.log(`Rendering pages ${startPage}-${endPage} at ${width}px (${version}, ${mode} mode)...\n`);

let totalCount = 0;
for (let page = startPage; page <= endPage; page++) {
  const count = await renderPage(page);
  totalCount += count;
  process.stdout.write(`\r  page ${page}/${endPage}`);
}

db.close();
const label = mode === RenderMode.Page ? "pages" : "lines";
console.log(`\n\nDone — ${totalCount} ${label} across ${endPage - startPage + 1} pages`);
