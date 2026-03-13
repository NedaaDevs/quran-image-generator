import path from "path";
import { generate } from "./generator";
import { FontVersion, ImageFormat, RenderMode } from "./types";

// import.meta.dir works in dev (bun run), process.execPath for compiled binary
const isCompiled = !import.meta.dir.startsWith("/");
const ROOT = isCompiled ? path.dirname(process.execPath) : path.join(import.meta.dir, "..");

const version = process.argv.includes("v4") ? FontVersion.V4 : process.argv.includes("v2") ? FontVersion.V2 : FontVersion.V1;
const startPage = Number(process.argv[2]) || 1;
const endPage = Number(process.argv[3]) || startPage;
const width = Number(process.argv[4]) || 1440;
const mode = process.argv[5] === "page" ? RenderMode.Page : RenderMode.Line;
const format = process.argv.includes("webp") ? ImageFormat.WebP : ImageFormat.PNG;
const withMarkers = !process.argv.includes("no-markers");
const showBounds = process.argv.includes("bounds");
const boundsJson = process.argv.includes("json");
const quantizeAlpha = process.argv.includes("quantize");

if (startPage < 1 || endPage > 604 || startPage > endPage) {
  console.error("Usage: bun src/cli.ts [startPage] [endPage] [width] [mode] [markers] [v1|v2]");
  console.error("  Pages: 1-604, width default: 1440, mode: line|page, font: v1|v2 (default v1)");
  process.exit(1);
}

console.log(`Rendering pages ${startPage}-${endPage} at ${width}px (${version}, ${mode} mode, ${format})...\n`);

const { count, boundsCount } = await generate({
  version,
  mode,
  format,
  startPage,
  endPage,
  width,
  withMarkers,
  showBounds,
  boundsJson,
  quantizeAlpha,
  outputDir: path.join(ROOT, "output"),
  dataDir: path.join(ROOT, "data"),
  onProgress: (page) => process.stdout.write(`\r  page ${page}/${endPage}`),
});

const label = mode === RenderMode.Page ? "pages" : "lines";
console.log(`\nDone — ${count} ${label} across ${endPage - startPage + 1} pages`);
if (boundsCount > 0) console.log(`  Bounds: ${boundsCount} glyphs (SQLite)`);
