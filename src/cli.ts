import path from "path";
import { generate } from "./generator";
import { FontVersion, RenderMode } from "./types";

const ROOT = path.join(import.meta.dir, "..");

const version = process.argv.includes("v2") ? FontVersion.V2 : FontVersion.V1;
const startPage = Number(process.argv[2]) || 1;
const endPage = Number(process.argv[3]) || startPage;
const width = Number(process.argv[4]) || 1440;
const mode = process.argv[5] === "page" ? RenderMode.Page : RenderMode.Line;
const withMarkers = process.argv.includes("markers");
const showBounds = process.argv.includes("bounds");

if (startPage < 1 || endPage > 604 || startPage > endPage) {
  console.error("Usage: bun src/cli.ts [startPage] [endPage] [width] [mode] [markers] [v1|v2]");
  console.error("  Pages: 1-604, width default: 1440, mode: line|page, font: v1|v2 (default v1)");
  process.exit(1);
}

console.log(`Rendering pages ${startPage}-${endPage} at ${width}px (${version}, ${mode} mode)...\n`);

const { count, bounds } = await generate({
  version,
  mode,
  startPage,
  endPage,
  width,
  withMarkers,
  showBounds,
  outputDir: path.join(ROOT, "output"),
  dataDir: path.join(ROOT, "data"),
  onProgress: (page) => process.stdout.write(`\r  page ${page}/${endPage}`),
});

// Write bounds JSON alongside rendered images
if (bounds.length > 0) {
  const boundsPath = path.join(ROOT, "output", version, "bounds", `${width}.json`);
  const { mkdirSync } = await import("fs");
  mkdirSync(path.dirname(boundsPath), { recursive: true });
  await Bun.write(boundsPath, JSON.stringify(bounds));
  console.log(`\n  Bounds: ${boundsPath} (${bounds.length} glyphs)`);
}

const label = mode === RenderMode.Page ? "pages" : "lines";
console.log(`\nDone — ${count} ${label} across ${endPage - startPage + 1} pages`);
