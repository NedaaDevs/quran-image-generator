import { mkdirSync } from "fs";
import path from "path";
import { createBoundsDb } from "./bounds-db";
import { createDb } from "./database";
import { registerPageFont } from "./font-loader";
import { measurePage, renderLine, renderBlankLine, renderFullPage } from "./renderer";
import { LINES_PER_PAGE, RenderMode, type FontVersion } from "./types";

export interface GeneratorOptions {
  version: FontVersion;
  mode: RenderMode;
  startPage: number;
  endPage: number;
  width: number;
  withMarkers: boolean;
  showBounds: boolean;
  outputDir: string;
  dataDir: string;
  onProgress?: (page: number, total: number) => void;
}

export interface GeneratorResult {
  count: number;
  boundsCount: number;
}

export const generate = async (opts: GeneratorOptions): Promise<GeneratorResult> => {
  const dbPath = path.join(opts.dataDir, opts.version, "db", "quran-layout.db");
  const fontsDir = path.join(opts.dataDir, opts.version, "fonts");
  const db = createDb(dbPath);

  // Bounds written to SQLite for efficient per-page/ayah queries at runtime
  const boundsDbPath = path.join(opts.outputDir, opts.version, "bounds", `${opts.width}.db`);
  const boundsDb = createBoundsDb(boundsDbPath);
  boundsDb.begin();

  let count = 0;
  let boundsCount = 0;

  for (let page = opts.startPage; page <= opts.endPage; page++) {
    const fontFamily = registerPageFont(fontsDir, page, opts.version);
    const lines = db.getPageLines(page);
    const lineInputs = lines.map((l) => ({
      ...l,
      glyphs: db.getLineGlyphs(page, l.line, true),
    }));

    if (opts.mode === RenderMode.Page) {
      const { buffer, bounds } = renderFullPage(fontFamily, lineInputs, opts.width, page, opts.withMarkers, opts.showBounds);
      const outDir = path.join(opts.outputDir, opts.version, "pages", String(opts.width));
      mkdirSync(outDir, { recursive: true });
      await Bun.write(path.join(outDir, `${page}.png`), buffer);
      boundsDb.writeBounds(bounds);
      boundsCount += bounds.length;
      count++;
    } else {
      const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(fontFamily, lineInputs, opts.width);
      const outDir = path.join(opts.outputDir, opts.version, "lines", String(opts.width), String(page));
      mkdirSync(outDir, { recursive: true });

      const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
      const blankPng = renderBlankLine(opts.width, lineHeight);

      // Always output full grid — blank PNGs for empty slots
      for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
        const ld = lineMap.get(lineNum);
        if (ld && ld.glyphs.length > 0) {
          const { buffer, bounds } = renderLine(
            fontFamily, fontSize, opts.width, { lineHeight, ascent, descent },
            ld, opts.withMarkers, page, opts.showBounds
          );
          await Bun.write(path.join(outDir, `${lineNum}.png`), buffer);
          boundsDb.writeBounds(bounds);
          boundsCount += bounds.length;
        } else {
          await Bun.write(path.join(outDir, `${lineNum}.png`), blankPng);
        }
        count++;
      }
    }

    opts.onProgress?.(page, opts.endPage - opts.startPage + 1);
  }

  boundsDb.commit();
  boundsDb.close();
  db.close();
  return { count, boundsCount };
};
