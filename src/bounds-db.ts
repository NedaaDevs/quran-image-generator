import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import path from "path";
import type { GlyphBounds, LineType } from "./types";

export interface LineMetadata {
  page: number;
  line: number;
  type: LineType;
  surahNumber?: number;
}

export const createBoundsDb = (dbPath: string) => {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS glyph_bounds");
  db.run("DROP TABLE IF EXISTS line_metadata");

  db.run(`CREATE TABLE glyph_bounds (
    page INTEGER NOT NULL,
    line INTEGER NOT NULL,
    position INTEGER NOT NULL,
    surah_number INTEGER NOT NULL,
    ayah_number INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    is_marker INTEGER NOT NULL DEFAULT 0
  )`);
  db.run("CREATE INDEX idx_bounds_page ON glyph_bounds(page)");
  db.run("CREATE INDEX idx_bounds_ayah ON glyph_bounds(surah_number, ayah_number)");

  // Lets the app know where to place surah header and basmala overlays
  db.run(`CREATE TABLE line_metadata (
    page INTEGER NOT NULL,
    line INTEGER NOT NULL,
    type TEXT NOT NULL,
    surah_number INTEGER,
    PRIMARY KEY (page, line)
  )`);

  const insertBound = db.prepare(
    "INSERT INTO glyph_bounds (page, line, position, surah_number, ayah_number, x, y, width, height, is_marker) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const insertMeta = db.prepare(
    "INSERT INTO line_metadata (page, line, type, surah_number) VALUES (?, ?, ?, ?)"
  );

  const begin = () => db.run("BEGIN");
  const commit = () => db.run("COMMIT");

  const writeBounds = (bounds: GlyphBounds[]) => {
    for (const b of bounds) {
      insertBound.run(b.page, b.line, b.position, b.surahNumber, b.ayahNumber, b.x, b.y, b.width, b.height, b.isMarker ? 1 : 0);
    }
  };

  const writeLineMetadata = (meta: LineMetadata[]) => {
    for (const m of meta) {
      insertMeta.run(m.page, m.line, m.type, m.surahNumber ?? null);
    }
  };

  const close = () => db.close();

  return { begin, commit, writeBounds, writeLineMetadata, close };
};
