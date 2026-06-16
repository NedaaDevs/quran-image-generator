import { Database } from "bun:sqlite";
import path from "node:path";
import type { GlyphData, LineType } from "./types";

export interface SurahMeta {
	name: string;
	hasBasmala: boolean;
}

// Loads surah metadata from version's layout DB (1-indexed: surahMeta[1] = { name: "الفاتحة", hasBasmala: false })
export const loadSurahMeta = (dataDir: string, version: string): SurahMeta[] => {
	const db = new Database(path.join(dataDir, version, "quran-layout.db"), { readonly: true });
	const rows = db.query("SELECT number, name_arabic, bismillah_pre FROM surahs ORDER BY number").all() as Array<{
		number: number;
		name_arabic: string;
		bismillah_pre: number;
	}>;
	db.close();
	const meta: SurahMeta[] = [{ name: "", hasBasmala: false }];
	for (const r of rows) meta[r.number] = { name: r.name_arabic, hasBasmala: r.bismillah_pre === 1 };
	return meta;
};

export const createDb = (dbPath: string) => {
	const db = new Database(dbPath, { readonly: true });

	const lineStmt = db.query("SELECT line, type, surah_number FROM mushaf_layout WHERE page = ? ORDER BY line");

	const glyphStmt = db.query(
		"SELECT position, text_qpc, surah_number, ayah_number, word_index FROM mushaf_words WHERE page = ? AND line = ? ORDER BY position ASC",
	);

	const getPageLines = (page: number) =>
		lineStmt.all(page) as Array<{ line: number; type: LineType; surah_number: number | null }>;

	interface RawGlyph {
		position: number;
		text_qpc: string;
		surah_number: number;
		ayah_number: number;
		word_index: number;
	}

	const getLineGlyphs = (page: number, line: number, splitMarkers = false) => {
		const rows = glyphStmt.all(page, line) as RawGlyph[];
		const glyphs: GlyphData[] = rows.map((r) => ({
			position: r.position,
			text_qpc: r.text_qpc,
			surahNumber: r.surah_number,
			ayahNumber: r.ayah_number,
			wordIndex: r.word_index,
		}));
		if (!splitMarkers) return glyphs;

		// End-of-ayah entries are space-separated: "word marker" when the marker sits on the
		// same line as its word, or " marker" (leading space, empty word) when the ayah filled
		// the previous line and the marker spilled to the start of this one.
		// Split into the word glyph + the marker glyph (flagged); drop the empty word if any.
		return glyphs.flatMap((g) => {
			const spaceIdx = g.text_qpc.indexOf(" ");
			if (spaceIdx === -1) return [g];
			const word = g.text_qpc.slice(0, spaceIdx);
			const marker = { ...g, text_qpc: g.text_qpc.slice(spaceIdx + 1), isMarker: true };
			return word ? [{ ...g, text_qpc: word }, marker] : [marker];
		});
	};

	const close = () => db.close();

	return { getPageLines, getLineGlyphs, close };
};
