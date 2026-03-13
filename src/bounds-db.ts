import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import path from "path";
import type { GlyphBounds } from "./types";

export const createBoundsDb = (dbPath: string) => {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS glyph_bounds");
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
    is_marker INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (page, line, position)
  )`);
  db.run("CREATE INDEX idx_bounds_page ON glyph_bounds(page)");
  db.run("CREATE INDEX idx_bounds_ayah ON glyph_bounds(surah_number, ayah_number)");

  const insert = db.prepare(
    "INSERT INTO glyph_bounds (page, line, position, surah_number, ayah_number, x, y, width, height, is_marker) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const begin = () => db.run("BEGIN");
  const commit = () => db.run("COMMIT");

  const writeBounds = (bounds: GlyphBounds[]) => {
    for (const b of bounds) {
      insert.run(b.page, b.line, b.position, b.surahNumber, b.ayahNumber, b.x, b.y, b.width, b.height, b.isMarker ? 1 : 0);
    }
  };

  const close = () => db.close();

  return { begin, commit, writeBounds, close };
};
