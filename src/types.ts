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

export interface GlyphData {
  position: number;
  text_qpc: string;
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
