import { Database } from "bun:sqlite";
import type { GlyphData } from "./types";

export const createDb = (dbPath: string) => {
  const db = new Database(dbPath, { readonly: true });

  const lineStmt = db.query(
    "SELECT line, type FROM mushaf_layout WHERE page = ? ORDER BY line"
  );

  const glyphStmt = db.query(
    "SELECT position, text_qpc FROM mushaf_words WHERE page = ? AND line = ? ORDER BY position ASC"
  );

  const getPageLines = (page: number) =>
    lineStmt.all(page) as Array<{ line: number; type: string }>;

  const getLineGlyphs = (page: number, line: number) =>
    glyphStmt.all(page, line) as GlyphData[];

  const close = () => db.close();

  return { getPageLines, getLineGlyphs, close };
};
