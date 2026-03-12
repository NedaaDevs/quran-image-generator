import { createCanvas } from "@napi-rs/canvas";
import { LineType, type LineInput, type MeasuredLine } from "./types";

const REF_SIZE = 100;
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

export const measurePage = (fontFamily: string, lines: LineInput[], width: number): PageMetrics => {
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

  // Horizontal padding: text area is inset from canvas edges
  const hPad = Math.floor(width * 0.02);
  const textWidth = width - hPad * 2;

  const fontSize = Math.floor(REF_SIZE * (textWidth / maxRefWidth));
  mx.font = `${fontSize}px "${fontFamily}"`;

  // Compute page-level ascent/descent across ALL glyphs on ALL lines
  let pageAscent = 0;
  let pageDescent = 0;
  for (const ld of lineData) {
    for (const g of ld.glyphs) {
      const m = mx.measureText(g.text_qpc);
      pageAscent = Math.max(pageAscent, m.actualBoundingBoxAscent);
      pageDescent = Math.max(pageDescent, m.actualBoundingBoxDescent);
    }
  }

  const pad = Math.ceil((pageAscent + pageDescent) * 0.15);
  const lineHeight = Math.ceil(pageAscent + pageDescent) + pad * 2;

  return { lineData, fontSize, lineHeight, ascent: pageAscent, descent: pageDescent, hPad };
};

const isSpecial = (type: LineType) =>
  type === LineType.SurahHeader || type === LineType.Basmala;

export const renderLine = (
  fontFamily: string,
  fontSize: number,
  width: number,
  metrics: Pick<PageMetrics, "lineHeight" | "ascent" | "descent" | "hPad">,
  ld: MeasuredLine
) => {
  mx.font = `${fontSize}px "${fontFamily}"`;

  const glyphs = ld.glyphs.map((g) => ({
    ...g,
    w: mx.measureText(g.text_qpc).width,
  }));
  const total = glyphs.reduce((s, g) => s + g.w, 0);

  const canvas = createCanvas(width, metrics.lineHeight);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  // Center text vertically: equal space above ascent and below descent
  const baseline = Math.floor((metrics.lineHeight + metrics.ascent - metrics.descent) / 2);

  const textWidth = width - metrics.hPad * 2;

  if (isSpecial(ld.type)) {
    let x = metrics.hPad + (textWidth + total) / 2;
    for (const g of glyphs) {
      x -= g.w;
      if (!g.isMarker) ctx.fillText(g.text_qpc, x, baseline);
    }
  } else {
    const fillRatio = total / textWidth;
    const gap =
      fillRatio > 0.7 && glyphs.length > 1
        ? (textWidth - total) / (glyphs.length - 1)
        : 0;
    let x = width - metrics.hPad;
    for (const g of glyphs) {
      x -= g.w;
      if (!g.isMarker) ctx.fillText(g.text_qpc, x, baseline);
      x -= gap;
    }
  }

  return canvas.toBuffer("image/png");
};
