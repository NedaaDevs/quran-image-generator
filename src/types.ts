export enum LineType {
  Text = "text",
  SurahHeader = "surah-header",
  Basmala = "basmala",
}

export const RenderMode = {
  Line: "line",
  Page: "page",
} as const;

export type RenderMode = (typeof RenderMode)[keyof typeof RenderMode];

export const FontVersion = {
  V1: "v1",
  V2: "v2",
} as const;

export type FontVersion = (typeof FontVersion)[keyof typeof FontVersion];

export const ImageFormat = {
  PNG: "png",
  WebP: "webp",
} as const;

export type ImageFormat = (typeof ImageFormat)[keyof typeof ImageFormat];

export type CanvasMime = "image/png" | "image/webp";

// Pixel bounding box for a single glyph — links visual position to ayah identity
export interface GlyphBounds {
  page: number;
  line: number;
  position: number;
  surahNumber: number;
  ayahNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isMarker: boolean;
}

export interface GlyphData {
  position: number;
  text_qpc: string;
  surahNumber: number;
  ayahNumber: number;
  isMarker?: boolean;
}

export interface MeasuredGlyph extends GlyphData {
  w: number;
}

export interface LineInput {
  line: number;
  type: LineType;
  glyphs: GlyphData[];
}

export interface MeasuredLine {
  line: number;
  type: LineType;
  glyphs: MeasuredGlyph[];
  total: number;
}

// Standard Mushaf page grid — all pages output this many line slots
export const LINES_PER_PAGE = 15;
