import { createCanvas } from "@napi-rs/canvas";
import { SURAH_HEADER_FONT } from "./font-loader";
import { ImageFormat, type CanvasMime, LineType, type GlyphBounds, type LineInput, type MeasuredLine } from "./types";

const toMime = (fmt: ImageFormat): CanvasMime =>
  fmt === ImageFormat.WebP ? "image/webp" : "image/png";

// Arbitrary reference size for initial glyph measurement — actual fontSize is scaled from this
const REF_SIZE = 100;
// Golden ratio — used for page aspect ratio and special page line spacing (pages 1-2)
const PHI = (Math.sqrt(5) + 1) / 2;
// Shared offscreen context for text measurement (avoids creating canvases per call)
const mc = createCanvas(1, 1);
const mx = mc.getContext("2d");

export interface PageMetrics {
  lineData: MeasuredLine[];
  fontSize: number;
  lineHeight: number;
  ascent: number;
  descent: number;
}

// Measures all glyphs on a page and computes fontSize to fit the widest text line exactly.
// Used by line-by-line mode; page mode (renderFullPage) does its own measurement.
export const measurePage = (fontFamily: string, lines: LineInput[], width: number): PageMetrics => {
  // Measure at REF_SIZE first, then scale — gives us the ratio to fit widest line to canvas width
  mx.font = `${REF_SIZE}px "${fontFamily}"`;

  let maxRefWidth = 0;
  const lineData: MeasuredLine[] = lines.map((l) => {
    const measured = l.glyphs.map((g) => ({
      ...g,
      w: mx.measureText(g.text_qpc).width,
    }));
    const total = measured.reduce((s, g) => s + g.w, 0);
    if (l.type === LineType.Text && total > maxRefWidth) maxRefWidth = total;
    return { ...l, glyphs: measured, total };
  });

  const fontSize = Math.floor(REF_SIZE * (width / maxRefWidth));
  mx.font = `${fontSize}px "${fontFamily}"`;

  // Page-wide ascent/descent ensures consistent baseline across all lines
  let pageAscent = 0;
  let pageDescent = 0;
  for (const ld of lineData) {
    for (const g of ld.glyphs) {
      const m = mx.measureText(g.text_qpc);
      pageAscent = Math.max(pageAscent, m.actualBoundingBoxAscent);
      pageDescent = Math.max(pageDescent, m.actualBoundingBoxDescent);
    }
  }

  // Standard Mushaf line height ratio — 232/1440 maintains correct vertical proportion
  const lineHeight = Math.round(width * 232 / 1440);

  return { lineData, fontSize, lineHeight, ascent: pageAscent, descent: pageDescent };
};

const isSpecial = (type: LineType) =>
  type === LineType.SurahHeader || type === LineType.Basmala;

// Glyph-by-glyph render enables inter-word gap adjustment for justification
const drawLine = (
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  fontFamily: string,
  fontSize: number,
  width: number,
  ld: MeasuredLine,
  baseline: number,
  page: number,
  withMarkers = false,
  justify = true
): GlyphBounds[] => {
  mx.font = `${fontSize}px "${fontFamily}"`;
  const glyphs = ld.glyphs.map((g) => ({
    ...g,
    w: mx.measureText(g.text_qpc).width,
  }));
  const total = glyphs.reduce((s, g) => s + g.w, 0);
  const shouldDraw = (g: { isMarker?: boolean }) => !g.isMarker || withMarkers;

  const recordBound = (g: typeof glyphs[0], x: number) => {
    const gm = mx.measureText(g.text_qpc);
    return {
      page,
      line: ld.line,
      position: g.position,
      surahNumber: g.surahNumber,
      ayahNumber: g.ayahNumber,
      x: Math.round(x),
      y: Math.round(baseline - gm.actualBoundingBoxAscent),
      width: Math.round(g.w),
      height: Math.round(gm.actualBoundingBoxAscent + gm.actualBoundingBoxDescent),
      isMarker: g.isMarker ?? false,
    };
  };

  const bounds: GlyphBounds[] = [];

  if (isSpecial(ld.type) || !justify) {
    let x = (width + total) / 2;
    for (const g of glyphs) {
      x -= g.w;
      if (shouldDraw(g)) ctx.fillText(g.text_qpc, x, baseline);
      bounds.push(recordBound(g, x));
    }
  } else {
    // Justify: group each word with its following marker, then distribute gaps evenly
    const groups: { glyphs: typeof glyphs; w: number }[] = [];
    for (let i = 0; i < glyphs.length; i++) {
      const cur = glyphs[i]!;
      const next = glyphs[i + 1];
      if (next?.isMarker) {
        groups.push({ glyphs: [cur, next], w: cur.w + next.w });
        i++;
      } else {
        groups.push({ glyphs: [cur], w: cur.w });
      }
    }

    // Only justify if text fills >70% of width — avoids ugly gaps on short lines
    const fillRatio = total / width;
    const gap =
      fillRatio > 0.7 && groups.length > 1
        ? (width - total) / (groups.length - 1)
        : 0;
    let x = width;
    for (const group of groups) {
      for (const g of group.glyphs) {
        x -= g.w;
        if (shouldDraw(g)) ctx.fillText(g.text_qpc, x, baseline);
        bounds.push(recordBound(g, x));
      }
      x -= gap;
    }
  }

  return bounds;
};

export interface RenderLineResult {
  buffer: Buffer;
  bounds: GlyphBounds[];
}

// Renders a single line as a standalone PNG — full-string centered rendering.
// Unlike drawLine (glyph-by-glyph), this lets the font engine handle kerning/spacing natively.
// Calculates per-glyph bounds using substring measurement for accurate hit areas.
export const renderLine = (
  fontFamily: string,
  fontSize: number,
  width: number,
  metrics: Pick<PageMetrics, "lineHeight" | "ascent" | "descent">,
  ld: MeasuredLine,
  withMarkers = false,
  page = 0,
  showBounds = false,
  format = ImageFormat.PNG
): RenderLineResult => {
  const canvas = createCanvas(width, metrics.lineHeight);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "rtl";
  ctx.textAlign = "center";

  // Draw text without markers; bounds are always computed for ALL glyphs
  // so the app can position marker overlays from bounds data
  const drawGlyphs = ld.glyphs.filter((g) => withMarkers || !g.isMarker);
  const lineText = drawGlyphs.map((g) => g.text_qpc).join("");

  const baseline = Math.floor((metrics.lineHeight + metrics.ascent - metrics.descent) / 2);
  ctx.fillText(lineText, width / 2, baseline);

  // QCF fonts use one code point per word — no inter-glyph kerning to worry about
  const allGlyphs = ld.glyphs;
  const fullText = allGlyphs.map((g) => g.text_qpc).join("");
  const fullWidth = ctx.measureText(fullText).width;

  const bounds: GlyphBounds[] = [];
  let cursorX = (width + fullWidth) / 2;

  for (const g of allGlyphs) {
    const gm = ctx.measureText(g.text_qpc);
    const glyphW = gm.width;
    cursorX -= glyphW;

    bounds.push({
      page,
      line: ld.line,
      position: g.position,
      surahNumber: g.surahNumber,
      ayahNumber: g.ayahNumber,
      x: Math.round(cursorX),
      y: Math.round(baseline - gm.actualBoundingBoxAscent),
      width: Math.round(glyphW),
      height: Math.round(gm.actualBoundingBoxAscent + gm.actualBoundingBoxDescent),
      isMarker: g.isMarker ?? false,
    });
  }

  // Draw semi-transparent colored rectangles over each glyph for visual validation
  if (showBounds) {
    const colors = ["rgba(255,0,0,0.25)", "rgba(0,0,255,0.25)"];
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i]!;
      ctx.fillStyle = colors[i % 2]!;
      ctx.fillRect(b.x, b.y, b.width, b.height);
    }
  }

  return { buffer: canvas.toBuffer(toMime(format)), bounds };
};

const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

// TODO: replace UthmanicHafs with a calligraphic Mushaf font matching the QPC style
// Renders surah name centered as a standalone line image
export const renderSurahHeader = (width: number, lineHeight: number, surahName: string, format = ImageFormat.PNG): Buffer => {
  const canvas = createCanvas(width, lineHeight);
  const ctx = canvas.getContext("2d");
  const fontSize = Math.floor(lineHeight * 0.45);
  ctx.font = `${fontSize}px "${SURAH_HEADER_FONT}"`;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  ctx.fillText(`سُورَةُ ${surahName}`, width / 2, lineHeight / 2);
  return canvas.toBuffer(toMime(format));
};

// Renders basmala centered as a standalone line image
export const renderBasmala = (width: number, lineHeight: number, format = ImageFormat.PNG): Buffer => {
  const canvas = createCanvas(width, lineHeight);
  const ctx = canvas.getContext("2d");
  const fontSize = Math.floor(lineHeight * 0.45);
  ctx.font = `${fontSize}px "${SURAH_HEADER_FONT}"`;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  ctx.fillText(BASMALA, width / 2, lineHeight / 2);
  return canvas.toBuffer(toMime(format));
};

// Blank transparent image at the standard line dimensions — used for empty slots in the 15-line grid
export const renderBlankLine = (width: number, lineHeight: number, format = ImageFormat.PNG): Buffer =>
  createCanvas(width, lineHeight).toBuffer(toMime(format));

export interface RenderPageResult {
  buffer: Buffer;
  bounds: GlyphBounds[];
}

// Renders all lines of a page onto a single canvas with PHI aspect ratio.
// Uses glyph-by-glyph justified layout (drawLine) for precise word positioning.
export const renderFullPage = (
  fontFamily: string,
  lines: LineInput[],
  width: number,
  page: number,
  withMarkers = false,
  showBounds = false,
  surahNames?: readonly string[],
  format = ImageFormat.PNG
): RenderPageResult => {
  const height = Math.ceil(width * PHI);
  // Fixed font ratio matching standard Mushaf typesetting (page 270 needs slight adjustment)
  const fontFactor = page === 270 ? 22.5 : 21;
  const fontSize = Math.floor(width / fontFactor);
  mx.font = `${fontSize}px "${fontFamily}"`;

  // Measure glyphs at fixed font size
  const lineData: MeasuredLine[] = lines.map((l) => {
    const measured = l.glyphs.map((g) => ({
      ...g,
      w: mx.measureText(g.text_qpc).width,
    }));
    const total = measured.reduce((s, g) => s + g.w, 0);
    return { ...l, glyphs: measured, total };
  });

  // Font-level ascent (GD's char_up): 2 * charUp * 15 lines + margin ≈ page height
  const charUp = mx.measureText("\u0020").fontBoundingBoxAscent;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  const isSpecialPage = page === 1 || page === 2;
  const lineSpacing = isSpecialPage ? PHI * charUp : 2 * charUp;
  // Include all lines — special lines (surah headers, basmalas) rendered with UthmanicHafs
  const activeLines = lineData.filter(
    (ld) => ld.glyphs.length > 0 || isSpecial(ld.type)
  );

  // Pages 1-2: center content vertically (fewer lines with wider spacing)
  let coordY: number;
  if (isSpecialPage) {
    const contentHeight = charUp + (activeLines.length - 1) * lineSpacing;
    coordY = (height - contentHeight) / 2;
  } else {
    // Standard pages: fixed top margin (matches quran.com)
    coordY = fontSize / 2;
  }

  const allBounds: GlyphBounds[] = [];
  const headerFontSize = Math.floor(fontSize * 0.65);

  for (const ld of activeLines) {
    // First line: advance past ascent so text doesn't clip top edge
    if (ld === activeLines[0]) {
      coordY += charUp;
    }

    const baseline = coordY;

    if (isSpecial(ld.type) && ld.glyphs.length === 0) {
      // Render surah header or basmala with UthmanicHafs font
      ctx.save();
      ctx.font = `${headerFontSize}px "${SURAH_HEADER_FONT}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.direction = "rtl";
      const centerY = baseline - charUp / 2 + lineSpacing / 2;
      if (ld.type === LineType.SurahHeader && ld.surah_number) {
        const name = surahNames?.[ld.surah_number] ?? "";
        ctx.fillText(`سُورَةُ ${name}`, width / 2, centerY);
      } else if (ld.type === LineType.Basmala) {
        ctx.fillText(BASMALA, width / 2, centerY);
      }
      ctx.restore();
    } else {
      const lineBounds = drawLine(ctx, fontFamily, fontSize, width, ld, baseline, page, withMarkers, false);
      allBounds.push(...lineBounds);
    }

    // Advance Y — no descent subtraction because GD's char_down is 0 for QCF fonts
    // (GD::Text measures 'Mj' which isn't in QCF fonts, so bbox returns 0)
    coordY += lineSpacing;
  }

  if (showBounds) {
    const colors = ["rgba(255,0,0,0.25)", "rgba(0,0,255,0.25)"];
    for (let i = 0; i < allBounds.length; i++) {
      const b = allBounds[i]!;
      ctx.fillStyle = colors[i % 2]!;
      ctx.fillRect(b.x, b.y, b.width, b.height);
    }
  }

  return { buffer: canvas.toBuffer(toMime(format)), bounds: allBounds };
};
