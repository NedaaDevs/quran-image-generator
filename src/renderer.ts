import { createCanvas } from "@napi-rs/canvas";
import { SURAH_NAME_FONT, SURAH_HEADER_FONT, BASMALA_FONT } from "./font-loader";
import { ImageFormat, type CanvasMime, LINES_PER_PAGE, LineType, type GlyphBounds, type LineInput, type MeasuredLine } from "./types";

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

// Composites ornamental frame + version-matched surah name (ligature font)
export const renderSurahHeader = (
  width: number, lineHeight: number, surahNumber: number,
  headerGlyphs: Record<string, string>, format = ImageFormat.PNG
): Buffer => {
  const canvas = createCanvas(width, lineHeight);
  const ctx = canvas.getContext("2d");

  const glyph = headerGlyphs[`surah-${surahNumber}`];
  if (glyph) {
    // Frame font renders ornamental border + surah name as one glyph
    mx.font = `100px "${SURAH_HEADER_FONT}"`;
    const refW = mx.measureText(glyph.trim()).width;
    const fontSize = Math.floor(100 * width / refW);
    ctx.font = `${fontSize}px "${SURAH_HEADER_FONT}"`;
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph.trim(), width / 2, lineHeight / 2);
  }

  return canvas.toBuffer(toMime(format));
};

// Builds "سورة <name>" ligature text — v1/v4 need "surah-icon" prefix, v2 bakes it in
const surahNameText = (surahNumber: number, fontSize: number): string => {
  const name = `surah${String(surahNumber).padStart(3, "0")}`;
  mx.font = `${fontSize}px "${SURAH_NAME_FONT}"`;
  const iconW = mx.measureText("surah-icon").width;
  // Ligature glyph is compact (~1.3x fontSize); missing glyph renders individual chars (~5x)
  // Name before icon — ligatures produce Arabic glyphs which render RTL naturally
  return iconW > 0 && iconW < fontSize * 2 ? `${name} surah-icon` : name;
};

// Renders version-matched surah name as standalone line image
export const renderSurahName = (width: number, lineHeight: number, surahNumber: number, format = ImageFormat.PNG): Buffer => {
  const canvas = createCanvas(width, lineHeight);
  const ctx = canvas.getContext("2d");
  const fontSize = Math.floor(lineHeight * 0.45);
  ctx.font = `${fontSize}px "${SURAH_NAME_FONT}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillText(surahNameText(surahNumber, fontSize), width / 2, lineHeight / 2);
  return canvas.toBuffer(toMime(format));
};

// Extracts the ornamental frame by diffing 3 surah headers to isolate shared pixels
export const renderSurahFrame = (width: number, lineHeight: number, headerGlyphs: Record<string, string>, format = ImageFormat.PNG): Buffer => {
  const render = (key: string) => {
    const glyph = (headerGlyphs[key] ?? "").trim();
    mx.font = `100px "${SURAH_HEADER_FONT}"`;
    const refW = mx.measureText(glyph).width;
    const fontSize = Math.floor(100 * width / refW);
    const c = createCanvas(width, lineHeight);
    const ctx = c.getContext("2d");
    ctx.font = `${fontSize}px "${SURAH_HEADER_FONT}"`;
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, width / 2, lineHeight / 2);
    return ctx.getImageData(0, 0, width, lineHeight).data;
  };

  // 3 surahs with different name lengths for clean extraction
  const d1 = render("surah-1");
  const d2 = render("surah-10");
  const d3 = render("surah-19");

  const c = createCanvas(width, lineHeight);
  const ctx = c.getContext("2d");
  const imgData = ctx.createImageData(width, lineHeight);
  for (let i = 0; i < d1.length; i += 4) {
    if (d1[i] === d2[i] && d2[i] === d3[i] &&
        d1[i+1] === d2[i+1] && d2[i+1] === d3[i+1] &&
        d1[i+2] === d2[i+2] && d2[i+2] === d3[i+2] &&
        d1[i+3] === d2[i+3] && d2[i+3] === d3[i+3]) {
      imgData.data[i] = d1[i]; imgData.data[i+1] = d1[i+1];
      imgData.data[i+2] = d1[i+2]; imgData.data[i+3] = d1[i+3];
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c.toBuffer(toMime(format));
};

// TODO: find proper basmala glyph codes per page font — UthmanicHafs is a style mismatch with QPC text
// Renders basmala centered as a standalone line image
export const renderBasmala = (width: number, lineHeight: number, fontSize: number, format = ImageFormat.PNG): Buffer => {
  const canvas = createCanvas(width, lineHeight);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px "${BASMALA_FONT}"`;
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

// Renders all lines of a page onto a single canvas — same sizing/spacing as line mode.
// Page image = 15 line slots stacked vertically, each rendered identically to line mode.
export const renderFullPage = (
  fontFamily: string,
  lines: LineInput[],
  width: number,
  page: number,
  withMarkers = false,
  showBounds = false,
  headerGlyphs: Record<string, string> = {},
  format = ImageFormat.PNG
): RenderPageResult => {
  // Reuse line mode's measurement for identical sizing
  const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(fontFamily, lines, width);
  const height = LINES_PER_PAGE * lineHeight;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
  const lineTypeMap = new Map(lines.map((l) => [l.line, l]));
  const allBounds: GlyphBounds[] = [];

  for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
    const ld = lineMap.get(lineNum);
    const lineInfo = lineTypeMap.get(lineNum);
    const y = (lineNum - 1) * lineHeight;

    ctx.save();

    if (ld && ld.glyphs.length > 0) {
      // Text line — same as renderLine
      ctx.font = `${fontSize}px "${fontFamily}"`;
      ctx.fillStyle = "#000000";
      ctx.textBaseline = "alphabetic";
      ctx.direction = "rtl";
      ctx.textAlign = "center";

      const baseline = y + Math.floor((lineHeight + ascent - descent) / 2);
      const drawGlyphs = ld.glyphs.filter((g) => withMarkers || !g.isMarker);
      const lineText = drawGlyphs.map((g) => g.text_qpc).join("");
      ctx.fillText(lineText, width / 2, baseline);

      // Compute per-glyph bounds
      const allGlyphs = ld.glyphs;
      const fullText = allGlyphs.map((g) => g.text_qpc).join("");
      const fullWidth = ctx.measureText(fullText).width;
      let cursorX = (width + fullWidth) / 2;
      for (const g of allGlyphs) {
        const gm = ctx.measureText(g.text_qpc);
        cursorX -= gm.width;
        allBounds.push({
          page, line: lineNum, position: g.position,
          surahNumber: g.surahNumber, ayahNumber: g.ayahNumber,
          x: Math.round(cursorX),
          y: Math.round(baseline - gm.actualBoundingBoxAscent),
          width: Math.round(gm.width),
          height: Math.round(gm.actualBoundingBoxAscent + gm.actualBoundingBoxDescent),
          isMarker: g.isMarker ?? false,
        });
      }
    } else if (lineInfo?.type === LineType.SurahHeader && lineInfo.surah_number) {
      if (withMarkers) {
        // Preview: frame font renders ornamental border + name as one glyph
        const glyph = headerGlyphs[`surah-${lineInfo.surah_number}`];
        if (glyph) {
          mx.font = `100px "${SURAH_HEADER_FONT}"`;
          const refW = mx.measureText(glyph.trim()).width;
          const hdrSize = Math.floor(100 * width / refW);
          ctx.font = `${hdrSize}px "${SURAH_HEADER_FONT}"`;
          ctx.fillStyle = "#000000";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(glyph.trim(), width / 2, y + lineHeight / 2);
        }
      } else {
        // App mode: version-matched surah name only, app overlays themed frame
        const nameFontSize = Math.floor(lineHeight * 0.45);
        ctx.font = `${nameFontSize}px "${SURAH_NAME_FONT}"`;
        ctx.fillStyle = "#000000";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.direction = "rtl";
        ctx.fillText(surahNameText(lineInfo.surah_number, nameFontSize), width / 2, y + lineHeight / 2);
      }
    } else if (lineInfo?.type === LineType.Basmala) {
      // Basmala is Quran text — always rendered regardless of withMarkers
      ctx.font = `${fontSize}px "${BASMALA_FONT}"`;
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.direction = "rtl";
      ctx.fillText(BASMALA, width / 2, y + lineHeight / 2);
    }
    // Empty slots / skipped decorative lines stay transparent

    ctx.restore();
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
