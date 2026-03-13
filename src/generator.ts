import { mkdirSync } from "fs";
import { losslessCompressPng } from "@napi-rs/image";
import sharp from "sharp";
import path from "path";
import type { GlyphBounds } from "./types";
import { createBoundsDb, type LineMetadata } from "./bounds-db";
import { createDb, loadSurahMeta } from "./database";
import { registerPageFont, registerSurahFonts } from "./font-loader";
import { measurePage, renderLine, renderBlankLine, renderSurahHeader, renderSurahName, renderSurahFrame, renderAyahMarker, renderBasmala, renderFullPage, setBasmalaText } from "./renderer";
import { ImageFormat, LINES_PER_PAGE, LineType, RenderMode, type FontVersion } from "./types";

export interface GeneratorOptions {
  version: FontVersion;
  mode: RenderMode;
  format: ImageFormat;
  startPage: number;
  endPage: number;
  pages?: number[];
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
  const dbPath = path.join(opts.dataDir, opts.version, "quran-layout.db");
  const fontsDir = path.join(opts.dataDir, opts.version, "fonts");
  const db = createDb(dbPath);
  const surahMeta = loadSurahMeta(opts.dataDir, opts.version);
  registerSurahFonts(opts.dataDir, opts.version);

  // Basmala glyph codes from page 1 line 2 (ayah 1:1) — split markers to exclude ayah number
  const basWords = db.getLineGlyphs(1, 2, true);
  setBasmalaText(basWords.filter((w) => !w.isMarker).map((w) => w.text_qpc).join(""));

  // Surah header font codepoint mapping (surah-N → Unicode glyph)
  const headerGlyphsPath = path.join(opts.dataDir, "common", "surah-header-ligatures.json");
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
  const boundsDbPath = path.join(opts.outputDir, opts.version, String(opts.width), "bounds.db");
  const boundsDb = createBoundsDb(boundsDbPath);
  boundsDb.begin();

  let count = 0;
  let boundsCount = 0;
  const jsonBounds: GlyphBounds[] = [];

  const allLineMetadata: LineMetadata[] = [];

  const pageSet = opts.pages ? new Set(opts.pages) : null;

  for (let page = opts.startPage; page <= opts.endPage; page++) {
    if (pageSet && !pageSet.has(page)) continue;
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
      const outDir = path.join(opts.outputDir, opts.version, String(opts.width), "pages");
      mkdirSync(outDir, { recursive: true });
      await Bun.write(path.join(outDir, `${pad(page, 3)}.${ext}`), await optimize(buffer));
      boundsDb.writeBounds(bounds);
      if (opts.boundsJson) jsonBounds.push(...bounds);
      boundsCount += bounds.length;
      count++;
    } else {
      const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(fontFamily, lineInputs, opts.width);
      const outDir = path.join(opts.outputDir, opts.version, String(opts.width), "lines", pad(page, 3));
      mkdirSync(outDir, { recursive: true });

      const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
      const lineTypeMap = new Map(lines.map((l) => [l.line, l]));
      const blankImg = await optimize(renderBlankLine(opts.width, lineHeight, fmt));

      // Center content vertically on pages with fewer than 15 lines (e.g. pages 1-2)
      const contentCount = lines.length;
      const centerOffset = contentCount < LINES_PER_PAGE ? Math.floor((LINES_PER_PAGE - contentCount) / 2) : 0;

      // Always output full grid — blank images for empty slots
      for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
        // Map output slot to source line (shifted by centering offset)
        const srcLine = lineNum - centerOffset;
        const ld = lineMap.get(srcLine);
        const lineInfo = lineTypeMap.get(srcLine);
        const filePath = path.join(outDir, `${pad(lineNum, 3)}.${ext}`);

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
          // With markers: frame + name; without: name only (frame is a theme asset)
          const hdr = opts.withMarkers
            ? renderSurahHeader(opts.width, lineHeight, lineInfo.surah_number, headerGlyphs, fmt)
            : renderSurahName(opts.width, lineHeight, lineInfo.surah_number, fmt);
          await Bun.write(filePath, await optimize(hdr));
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
    const jsonPath = path.join(opts.outputDir, opts.version, String(opts.width), "bounds.json");
    await Bun.write(jsonPath, JSON.stringify(jsonBounds));
  }

  // Generate reusable marker templates (ornamental assets for theme overlays)
  const lineHeight = Math.round(opts.width * 232 / 1440);
  const markersDir = path.join(opts.outputDir, opts.version, String(opts.width), "markers");
  mkdirSync(markersDir, { recursive: true });
  await Bun.write(
    path.join(markersDir, `surah-frame.${ext}`),
    await optimize(renderSurahFrame(opts.width, lineHeight, headerGlyphs, fmt))
  );
  await Bun.write(
    path.join(markersDir, `ayah-marker.${ext}`),
    await optimize(renderAyahMarker(opts.width, lineHeight, fmt))
  );

  db.close();
  return { count, boundsCount };
};
