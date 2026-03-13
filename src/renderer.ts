import { createCanvas } from "@napi-rs/canvas";
import { LineType, type GlyphBounds, type LineInput, type MeasuredLine } from "./types";

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
  hPad: number;
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

  // No horizontal padding — QCF fonts include built-in glyph spacing
  const hPad = 0;
  const textWidth = width;

  const fontSize = Math.floor(REF_SIZE * (textWidth / maxRefWidth));
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

  return { lineData, fontSize, lineHeight, ascent: pageAscent, descent: pageDescent, hPad };
};

const isSpecial = (type: LineType) =>
  type === LineType.SurahHeader || type === LineType.Basmala;

// Draws a single line glyph-by-glyph with justification or centering.
// Used by page mode where each line needs precise positioning on a shared canvas.
const drawLine = (
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  fontFamily: string,
  fontSize: number,
  width: number,
  hPad: number,
  ld: MeasuredLine,
  baseline: number,
  withMarkers = false,
  justify = true
) => {
  mx.font = `${fontSize}px "${fontFamily}"`;
  const glyphs = ld.glyphs.map((g) => ({
    ...g,
    w: mx.measureText(g.text_qpc).width,
  }));
  const total = glyphs.reduce((s, g) => s + g.w, 0);
  const textWidth = width - hPad * 2;
  const shouldDraw = (g: { isMarker?: boolean }) => !g.isMarker || withMarkers;

  if (isSpecial(ld.type) || !justify) {
    // Center line: natural glyph spacing, equal margins on both sides
    let x = hPad + (textWidth + total) / 2;
    for (const g of glyphs) {
      x -= g.w;
      if (shouldDraw(g)) ctx.fillText(g.text_qpc, x, baseline);
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
    const fillRatio = total / textWidth;
    const gap =
      fillRatio > 0.7 && groups.length > 1
        ? (textWidth - total) / (groups.length - 1)
        : 0;
    let x = width - hPad;
    for (const group of groups) {
      for (const g of group.glyphs) {
        x -= g.w;
        if (shouldDraw(g)) ctx.fillText(g.text_qpc, x, baseline);
      }
      x -= gap;
    }
  }
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
  metrics: Pick<PageMetrics, "lineHeight" | "ascent" | "descent" | "hPad">,
  ld: MeasuredLine,
  withMarkers = false,
  page = 0,
  showBounds = false
): RenderLineResult => {
  const canvas = createCanvas(width, metrics.lineHeight);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "rtl";
  ctx.textAlign = "center";

  // Filter glyphs based on marker preference
  const visibleGlyphs = ld.glyphs.filter((g) => withMarkers || !g.isMarker);
  const lineText = visibleGlyphs.map((g) => g.text_qpc).join("");

  const baseline = Math.floor((metrics.lineHeight + metrics.ascent - metrics.descent) / 2);
  ctx.fillText(lineText, width / 2, baseline);

  // Calculate per-glyph bounds by measuring each glyph individually.
  // QCF fonts use one code point per word — no inter-glyph kerning to worry about.
  const fullWidth = ctx.measureText(lineText).width;

  // RTL: first glyph in array is rightmost on screen
  const bounds: GlyphBounds[] = [];
  let cursorX = (width + fullWidth) / 2; // right edge of centered text

  for (const g of visibleGlyphs) {
    const gm = ctx.measureText(g.text_qpc);
    const glyphW = gm.width;
    cursorX -= glyphW;

    const y = baseline - gm.actualBoundingBoxAscent;
    const h = gm.actualBoundingBoxAscent + gm.actualBoundingBoxDescent;

    bounds.push({
      page,
      line: ld.line,
      position: g.position,
      surahNumber: g.surahNumber,
      ayahNumber: g.ayahNumber,
      x: Math.round(cursorX),
      y: Math.round(y),
      width: Math.round(glyphW),
      height: Math.round(h),
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

  return { buffer: canvas.toBuffer("image/png"), bounds };
};

// Renders all lines of a page onto a single canvas with PHI aspect ratio.
// Uses glyph-by-glyph justified layout (drawLine) for precise word positioning.
export const renderFullPage = (
  fontFamily: string,
  lines: LineInput[],
  width: number,
  page: number,
  withMarkers = false
) => {
  const height = Math.ceil(width * PHI);
  // No horizontal padding — matches quran.com (centering handles margins naturally)
  const hPad = 0;

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

  // Start with margin_top = fontSize / 2 (matches quran.com)
  let coordY = fontSize / 2;

  for (const ld of lineData) {
    if (ld.glyphs.length === 0) continue;

    // First line: advance past ascent so text doesn't clip top edge
    if (coordY <= fontSize / 2) {
      coordY += charUp;
    }

    const baseline = coordY;
    drawLine(ctx, fontFamily, fontSize, width, hPad, ld, baseline, withMarkers, false);

    // Advance Y — no descent subtraction because GD's char_down is 0 for QCF fonts
    // (GD::Text measures 'Mj' which isn't in QCF fonts, so bbox returns 0)
    if (page === 1 || page === 2) {
      // Pages 1-2: PHI * char_up (golden ratio spacing for Al-Fatiha / Al-Baqarah opening)
      coordY += PHI * charUp;
    } else {
      // Standard pages: 2 * char_up (matches quran.com line spacing)
      coordY += 2 * charUp;
    }
  }

  return canvas.toBuffer("image/png");
};
