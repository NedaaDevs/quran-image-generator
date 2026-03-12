export enum LineType {
  Text = "text",
  SurahHeader = "surah-header",
  Basmala = "basmala",
}

export interface GlyphData {
  position: number;
  text_qpc: string;
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
