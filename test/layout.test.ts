import { describe, expect, test } from "bun:test";
import { hasAssets, openLayout, TOTAL_AYAHS, VERSIONS } from "./helpers";

// Layer 1 — layout-DB invariants. Pure SQL on data/<v>/quran-layout.db, no rendering.
// Guards the marker-drop class of bug: every ayah must keep exactly one end-marker, stored
// as a single space-delimited cell.
for (const v of VERSIONS) {
	const present = hasAssets(v);
	describe(`layout invariants: ${v}`, () => {
		const db = present ? openLayout(v) : null;
		const count = (sql: string) => (db?.query(sql).get() as { c: number }).c;

		// A marker is a cell whose text_qpc embeds a space: "word marker" or " marker" (spilled).
		test.skipIf(!present)("exactly 6236 marker cells", () => {
			expect(count("SELECT COUNT(*) c FROM mushaf_words WHERE text_qpc LIKE '% %'")).toBe(TOTAL_AYAHS);
		});

		test.skipIf(!present)("6236 distinct (surah, ayah) markers", () => {
			expect(
				count(
					"SELECT COUNT(*) c FROM (SELECT DISTINCT surah_number, ayah_number FROM mushaf_words WHERE text_qpc LIKE '% %')",
				),
			).toBe(TOTAL_AYAHS);
		});

		test.skipIf(!present)("every surah has an ayah-1 marker", () => {
			const missing = db
				?.query(
					`WITH s(n) AS (SELECT DISTINCT surah_number FROM mushaf_words)
					 SELECT n FROM s
					 WHERE n NOT IN (SELECT surah_number FROM mushaf_words WHERE ayah_number = 1 AND text_qpc LIKE '% %')`,
				)
				.all() as { n: number }[];
			expect(missing).toEqual([]);
		});

		// The marker delimiter must be unambiguous — a second space would make splitMarkers
		// mis-split (the V1 stray-intra-word-space bug).
		test.skipIf(!present)("no cell has more than one space", () => {
			expect(count("SELECT COUNT(*) c FROM mushaf_words WHERE text_qpc LIKE '% % %'")).toBe(0);
		});
	});
}
