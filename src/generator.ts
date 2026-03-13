import { mkdirSync } from "fs";
import { losslessCompressPng } from "@napi-rs/image";
import sharp from "sharp";
import path from "path";
import type { GlyphBounds } from "./types";
import { createBoundsDb, type LineMetadata } from "./bounds-db";
import { createDb, loadSurahMeta } from "./database";
import { registerPageFont, registerSurahFonts } from "./font-loader";
import { measurePage, renderLine, renderBlankLine, renderSurahHeader, renderSurahFrame, renderBasmala, renderFullPage } from "./renderer";
import { ImageFormat, LINES_PER_PAGE, LineType, RenderMode, type FontVersion } from "./types";

export interface GeneratorOptions {
  version: FontVersion;
  mode: RenderMode;
  format: ImageFormat;
  startPage: number;
  endPage: number;
  width: number;
  withMarkers: boolean;
  showBounds: boolean;
  boundsJson: boolean;
  quantizeAlpha: boolean;
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
  registerSurahFonts(opts.dataDir, opts.version);

  // Surah header font codepoint mapping (surah-N → Unicode glyph)
  const headerGlyphsPath = path.join(opts.dataDir, "fonts", "surah-header-ligatures.json");
  const headerGlyphs: Record<string, string> = JSON.parse(await Bun.file(headerGlyphsPath).text());

  const fmt = opts.format;
  const ext = fmt === ImageFormat.WebP ? "webp" : "png";

  // Reduces anti-aliasing alpha from ~210 levels to 16, drastically improving PNG compression
  const quantizeAlpha = async (buf: Buffer): Promise<Buffer> => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const step = 255 / 15;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(Math.round(data[i] / step) * step);
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  };

  // Oxipng lossless optimization for PNG; WebP is already compact from canvas
  const optimize = async (buf: Buffer) => {
    if (fmt !== ImageFormat.PNG) return buf;
    const input = opts.quantizeAlpha ? await quantizeAlpha(buf) : buf;
    return losslessCompressPng(input);
  };

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
      const { buffer, bounds } = renderFullPage(fontFamily, lineInputs, opts.width, page, opts.withMarkers, opts.showBounds, headerGlyphs, fmt);
      const outDir = path.join(opts.outputDir, opts.version, "pages");
      mkdirSync(outDir, { recursive: true });
      await Bun.write(path.join(outDir, `${pad(page, 3)}.${ext}`), await optimize(buffer));
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
      const blankImg = await optimize(renderBlankLine(opts.width, lineHeight, fmt));

      // Always output full grid — blank images for empty slots
      for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
        const ld = lineMap.get(lineNum);
        const lineInfo = lineTypeMap.get(lineNum);
        const filePath = path.join(outDir, `${pad(lineNum, 2)}.${ext}`);

        if (ld && ld.glyphs.length > 0) {
          const { buffer, bounds } = renderLine(
            fontFamily, fontSize, opts.width, { lineHeight, ascent, descent },
            ld, opts.withMarkers, page, opts.showBounds, fmt
          );
          await Bun.write(filePath, await optimize(buffer));
          boundsDb.writeBounds(bounds);
          if (opts.boundsJson) jsonBounds.push(...bounds);
          boundsCount += bounds.length;
        } else if (lineInfo?.type === LineType.SurahHeader && lineInfo.surah_number) {
          await Bun.write(filePath, await optimize(renderSurahHeader(opts.width, lineHeight, lineInfo.surah_number, headerGlyphs, fmt)));
        } else if (lineInfo?.type === LineType.Basmala) {
          await Bun.write(filePath, await optimize(renderBasmala(opts.width, lineHeight, fontSize, fmt)));
        } else {
          await Bun.write(filePath, blankImg);
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

  // Generate reusable surah frame (ornamental border without text) once per version
  const lineHeight = Math.round(opts.width * 232 / 1440);
  const frameDir = path.join(opts.outputDir, opts.version);
  mkdirSync(frameDir, { recursive: true });
  await Bun.write(
    path.join(frameDir, `surah-frame.${ext}`),
    await optimize(renderSurahFrame(opts.width, lineHeight, headerGlyphs, fmt))
  );

  db.close();
  return { count, boundsCount };
};
