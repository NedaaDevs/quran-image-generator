import { mkdirSync } from "fs";
import path from "path";
import type { GlyphBounds } from "./types";
import { createBoundsDb, type LineMetadata } from "./bounds-db";
import { createDb, loadSurahMeta } from "./database";
import { registerPageFont, registerSurahHeaderFont } from "./font-loader";
import { measurePage, renderLine, renderBlankLine, renderSurahHeader, renderBasmala, renderFullPage } from "./renderer";
import { LINES_PER_PAGE, LineType, RenderMode, type FontVersion } from "./types";

export interface GeneratorOptions {
  version: FontVersion;
  mode: RenderMode;
  startPage: number;
  endPage: number;
  width: number;
  withMarkers: boolean;
  showBounds: boolean;
  boundsJson: boolean;
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
  const surahMeta = loadSurahMeta(opts.dataDir);
  const surahNames = surahMeta.map((m) => m.name);
  registerSurahHeaderFont(opts.dataDir);

  const pad = (n: number, len: number) => String(n).padStart(len, "0");

  // Bounds written to SQLite for efficient per-page/ayah queries at runtime
  const boundsDbPath = path.join(opts.outputDir, opts.version, "bounds.db");
  const boundsDb = createBoundsDb(boundsDbPath);
  boundsDb.begin();

  let count = 0;
  let boundsCount = 0;
  const jsonBounds: GlyphBounds[] = [];

  const allLineMetadata: LineMetadata[] = [];

  for (let page = opts.startPage; page <= opts.endPage; page++) {
    const fontFamily = registerPageFont(fontsDir, page, opts.version);
    const lines = db.getPageLines(page);

    for (const l of lines) {
      const surahNum = l.surah_number ?? undefined;
      allLineMetadata.push({
        page,
        line: l.line,
        type: l.type,
        surahNumber: surahNum,
        surahName: l.type === LineType.SurahHeader && surahNum ? surahMeta[surahNum]?.name : undefined,
      });
    }

    const lineInputs = lines.map((l) => ({
      ...l,
      glyphs: db.getLineGlyphs(page, l.line, true),
    }));

    if (opts.mode === RenderMode.Page) {
      const { buffer, bounds } = renderFullPage(fontFamily, lineInputs, opts.width, page, opts.withMarkers, opts.showBounds, surahNames);
      const outDir = path.join(opts.outputDir, opts.version, "pages");
      mkdirSync(outDir, { recursive: true });
      await Bun.write(path.join(outDir, `${pad(page, 3)}.png`), buffer);
      boundsDb.writeBounds(bounds);
      if (opts.boundsJson) jsonBounds.push(...bounds);
      boundsCount += bounds.length;
      count++;
    } else {
      const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(fontFamily, lineInputs, opts.width);
      const outDir = path.join(opts.outputDir, opts.version, "lines", pad(page, 3));
      mkdirSync(outDir, { recursive: true });

      const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
      const lineTypeMap = new Map(lines.map((l) => [l.line, l]));
      const blankPng = renderBlankLine(opts.width, lineHeight);

      // Always output full grid — blank PNGs for empty slots
      for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
        const ld = lineMap.get(lineNum);
        const lineInfo = lineTypeMap.get(lineNum);
        const filePath = path.join(outDir, `${pad(lineNum, 2)}.png`);

        if (ld && ld.glyphs.length > 0) {
          const { buffer, bounds } = renderLine(
            fontFamily, fontSize, opts.width, { lineHeight, ascent, descent },
            ld, opts.withMarkers, page, opts.showBounds
          );
          await Bun.write(filePath, buffer);
          boundsDb.writeBounds(bounds);
          if (opts.boundsJson) jsonBounds.push(...bounds);
          boundsCount += bounds.length;
        } else if (lineInfo?.type === LineType.SurahHeader && lineInfo.surah_number) {
          const name = surahMeta[lineInfo.surah_number]?.name ?? "";
          await Bun.write(filePath, renderSurahHeader(opts.width, lineHeight, name));
        } else if (lineInfo?.type === LineType.Basmala) {
          await Bun.write(filePath, renderBasmala(opts.width, lineHeight));
        } else {
          await Bun.write(filePath, blankPng);
        }
        count++;
      }
    }

    opts.onProgress?.(page, opts.endPage - opts.startPage + 1);
  }

  boundsDb.writeLineMetadata(allLineMetadata);
  boundsDb.commit();
  boundsDb.close();

  if (opts.boundsJson && jsonBounds.length > 0) {
    const jsonPath = path.join(opts.outputDir, opts.version, "bounds.json");
    await Bun.write(jsonPath, JSON.stringify(jsonBounds));
  }

  db.close();
  return { count, boundsCount };
};
