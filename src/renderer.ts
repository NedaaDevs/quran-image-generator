import { createCanvas } from "@napi-rs/canvas";
import { LineType, type LineInput, type MeasuredLine } from "./types";

const REF_SIZE = 100;
const mc = createCanvas(1, 1);
const mx = mc.getContext("2d");

export const measurePage = (fontFamily: string, lines: LineInput[], width: number) => {
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
  return { lineData, fontSize };
};

const isSpecial = (type: LineType) =>
  type === LineType.SurahHeader || type === LineType.Basmala;

export const renderLine = (
  fontFamily: string,
  fontSize: number,
  width: number,
  ld: MeasuredLine
) => {
  mx.font = `${fontSize}px "${fontFamily}"`;

  const glyphs = ld.glyphs.map((g) => ({
    ...g,
    w: mx.measureText(g.text_qpc).width,
  }));
  const total = glyphs.reduce((s, g) => s + g.w, 0);

  let ascent = 0;
  let descent = 0;
  for (const g of glyphs) {
    const m = mx.measureText(g.text_qpc);
    ascent = Math.max(ascent, m.actualBoundingBoxAscent);
    descent = Math.max(descent, m.actualBoundingBoxDescent);
  }

  const pad = Math.ceil((ascent + descent) * 0.15);
  const h = Math.ceil(ascent + descent) + pad * 2;

  const canvas = createCanvas(width, h);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  const baseline = ascent + pad;

  if (isSpecial(ld.type)) {
    let x = (width + total) / 2;
    for (const g of glyphs) {
      x -= g.w;
      ctx.fillText(g.text_qpc, x, baseline);
    }
  } else {
    const fillRatio = total / width;
    const gap =
      fillRatio > 0.7 && glyphs.length > 1
        ? (width - total) / (glyphs.length - 1)
        : 0;
    let x = width;
    for (const g of glyphs) {
      x -= g.w;
      ctx.fillText(g.text_qpc, x, baseline);
      x -= gap;
    }
  }

  return canvas.toBuffer("image/png");
};
