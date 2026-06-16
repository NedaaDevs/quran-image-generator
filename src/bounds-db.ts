import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { TajweedPaletteEntry } from "./font-palette";
import type { GlyphBounds, LineType } from "./types";

export interface LineMetadata {
	page: number;
	line: number;
	type: LineType;
	surahNumber?: number;
	surahName?: string;
}

// bounds.db schema version (PRAGMA user_version). Bump on any schema/column change so apps can
// detect a stale download and re-fetch. v2 added word_index, tajweed_index, and the tajweed_palette table.
export const BOUNDS_DB_VERSION = 2;

export const createBoundsDb = (dbPath: string) => {
	mkdirSync(path.dirname(dbPath), { recursive: true });

	const db = new Database(dbPath);

	db.run(`CREATE TABLE IF NOT EXISTS glyph_bounds (
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
    word_index INTEGER NOT NULL DEFAULT 0,
    tajweed_index TEXT
  )`);
	db.run("CREATE INDEX IF NOT EXISTS idx_bounds_page ON glyph_bounds(page)");
	db.run("CREATE INDEX IF NOT EXISTS idx_bounds_ayah ON glyph_bounds(surah_number, ayah_number)");

	// Lets the app know where to place surah header and basmala overlays
	db.run(`CREATE TABLE IF NOT EXISTS line_metadata (
    page INTEGER NOT NULL,
    line INTEGER NOT NULL,
    type TEXT NOT NULL,
    surah_number INTEGER,
    surah_name TEXT,
    PRIMARY KEY (page, line)
  )`);

	// Canonical tajwid palette (V4 only): glyph_bounds.tajweed_index values join to idx here. Lets a
	// consumer recover the font's native rule color; recoloring consumers ignore it. Empty for V1/V2.
	db.run(`CREATE TABLE IF NOT EXISTS tajweed_palette (
    idx INTEGER PRIMARY KEY,
    hex TEXT NOT NULL
  )`);

	// Stamp the version only once the schema is in place, so a stamped DB always implies valid columns.
	db.run(`PRAGMA user_version = ${BOUNDS_DB_VERSION}`);

	const delBounds = db.prepare("DELETE FROM glyph_bounds WHERE page = ?");
	const delMeta = db.prepare("DELETE FROM line_metadata WHERE page = ?");

	const insertBound = db.prepare(
		"INSERT INTO glyph_bounds (page, line, position, surah_number, ayah_number, x, y, width, height, is_marker, word_index, tajweed_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);

	const insertMeta = db.prepare(
		"INSERT INTO line_metadata (page, line, type, surah_number, surah_name) VALUES (?, ?, ?, ?, ?)",
	);

	const insertPalette = db.prepare("INSERT OR REPLACE INTO tajweed_palette (idx, hex) VALUES (?, ?)");

	const begin = () => db.run("BEGIN");
	const commit = () => db.run("COMMIT");

	const writeBounds = (bounds: GlyphBounds[]) => {
		for (const b of bounds) {
			insertBound.run(
				b.page,
				b.line,
				b.position,
				b.surahNumber,
				b.ayahNumber,
				b.x,
				b.y,
				b.width,
				b.height,
				b.isMarker ? 1 : 0,
				b.wordIndex,
				b.tajweedIndex,
			);
		}
	};

	const writeLineMetadata = (meta: LineMetadata[]) => {
		for (const m of meta) {
			insertMeta.run(m.page, m.line, m.type, m.surahNumber ?? null, m.surahName ?? null);
		}
	};

	const writeTajweedPalette = (entries: TajweedPaletteEntry[]) => {
		for (const e of entries) insertPalette.run(e.index, e.hex);
	};

	const clearPage = (page: number) => {
		delBounds.run(page);
		delMeta.run(page);
	};

	const close = () => db.close();

	return { begin, commit, clearPage, writeBounds, writeLineMetadata, writeTajweedPalette, close };
};
