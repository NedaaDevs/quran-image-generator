import { mkdirSync } from "fs";
import path from "path";
import { createDb } from "./database";
import { registerPageFont } from "./font-loader";
import { measurePage, renderLine, renderFullPage } from "./renderer";
import { type FontVersion, type RenderMode, RenderMode as Mode } from "./types";

export interface GeneratorOptions {
  version: FontVersion;
  mode: RenderMode;
  startPage: number;
  endPage: number;
  width: number;
  withMarkers: boolean;
  outputDir: string;
  dataDir: string;
  onProgress?: (page: number, total: number) => void;
}

export const generate = async (opts: GeneratorOptions) => {
  const dbPath = path.join(opts.dataDir, opts.version, "db", "quran-layout.db");
  const fontsDir = path.join(opts.dataDir, opts.version, "fonts");
  const db = createDb(dbPath);

  let totalCount = 0;

  for (let page = opts.startPage; page <= opts.endPage; page++) {
    const fontFamily = registerPageFont(fontsDir, page, opts.version);
    const lines = db.getPageLines(page);
    const lineInputs = lines.map((l) => ({
      ...l,
      glyphs: db.getLineGlyphs(page, l.line, true),
    }));

    if (opts.mode === Mode.Page) {
      const buffer = renderFullPage(fontFamily, lineInputs, opts.width, page, opts.withMarkers);
      const outDir = path.join(opts.outputDir, opts.version, "pages", String(opts.width));
      mkdirSync(outDir, { recursive: true });
      await Bun.write(path.join(outDir, `${page}.png`), buffer);
      totalCount++;
    } else {
      const { lineData, fontSize, lineHeight, ascent, descent, hPad } = measurePage(fontFamily, lineInputs, opts.width);
      const outDir = path.join(opts.outputDir, opts.version, "lines", String(opts.width), String(page));
      mkdirSync(outDir, { recursive: true });

      for (const ld of lineData) {
        if (ld.glyphs.length === 0) continue;
        const buffer = renderLine(fontFamily, fontSize, opts.width, { lineHeight, ascent, descent, hPad }, ld, opts.withMarkers);
        await Bun.write(path.join(outDir, `${ld.line}.png`), buffer);
        totalCount++;
      }
    }

    opts.onProgress?.(page, opts.endPage - opts.startPage + 1);
  }

  db.close();
  return totalCount;
};
