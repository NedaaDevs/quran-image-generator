import { Database } from "bun:sqlite";
import { LineType, type GlyphData } from "./types";

export const createDb = (dbPath: string) => {
  const db = new Database(dbPath, { readonly: true });

  const lineStmt = db.query(
    "SELECT line, type FROM mushaf_layout WHERE page = ? ORDER BY line"
  );

  const glyphStmt = db.query(
    "SELECT position, text_qpc FROM mushaf_words WHERE page = ? AND line = ? ORDER BY position ASC"
  );

  const getPageLines = (page: number) =>
    lineStmt.all(page) as Array<{ line: number; type: LineType }>;

  const getLineGlyphs = (page: number, line: number, splitMarkers = false) => {
    const glyphs = glyphStmt.all(page, line) as GlyphData[];
    if (!splitMarkers) return glyphs;

    // End-of-ayah entries have "textGlyph markerGlyph" (space-separated)
    // Split into two: the word glyph + the marker glyph (flagged)
    return glyphs.flatMap((g) => {
      const parts = g.text_qpc.split(" ");
      if (parts.length <= 1) return [g];
      return [
        { ...g, text_qpc: parts[0] },
        { position: g.position, text_qpc: parts[1], isMarker: true },
      ];
    });
  };

  const close = () => db.close();

  return { getPageLines, getLineGlyphs, close };
};
