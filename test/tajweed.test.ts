import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BOUNDS_DB_VERSION, createBoundsDb } from "../src/bounds-db";
import { buildTajweedResolver } from "../src/font-palette";
import { generate } from "../src/generator";
import { FontVersion, ImageFormat, RenderEngine, RenderMode } from "../src/types";
import { type BoundRow, DATA_DIR, hasAssets, renderRepPages, VERSIONS } from "./helpers";

const HEX = /^#[0-9A-F]{6}$/;
const INDEX_LIST = /^\d+(,\d+)*$/;

// Schema stamp + columns/tables — asset-free, exercises bounds-db.ts directly.
describe("bounds.db schema", () => {
	test("stamps user_version and has the new columns and palette table", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "qig-schema-"));
		try {
			createBoundsDb(path.join(dir, "bounds.db")).close();
			const ro = new Database(path.join(dir, "bounds.db"), { readonly: true });
			expect((ro.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(BOUNDS_DB_VERSION);
			const cols = (ro.query("PRAGMA table_info(glyph_bounds)").all() as { name: string }[]).map((c) => c.name);
			expect(cols).toContain("word_index");
			expect(cols).toContain("tajweed_index");
			const tables = (ro.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
				(t) => t.name,
			);
			expect(tables).toContain("tajweed_palette");
			ro.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// Resolver parses the V4 font's COLR/CPAL/cmap deterministically. Spot-check known p50 glyphs.
describe("tajweed resolver", () => {
	const fontPath = path.join(DATA_DIR, "v4", "fonts", "p50.ttf");
	const present = existsSync(fontPath);

	test.skipIf(!present)("resolves known p50 glyphs to CPAL slot indices", () => {
		const { resolve, palette } = buildTajweedResolver(readFileSync(fontPath));
		const cp = (n: number) => String.fromCodePoint(n);
		expect(resolve(cp(0xfc41))).toBe("3"); // single saturated rule
		expect(resolve(cp(0xfc49))).toBe("15,7,4"); // multi-rule word, source order
		expect(resolve(cp(0xfc4d))).toBe("15,5");
		expect(resolve(cp(0xfc46))).toBeNull(); // base ink only

		// Palette maps those indices to canonical hexes, all valid and uppercase.
		const byIdx = new Map(palette.map((e) => [e.index, e.hex]));
		expect(byIdx.get(3)).toBe("#B50000");
		expect(byIdx.get(5)).toBe("#CE9E00");
		expect(byIdx.get(15)).toBe("#9FA5A5");
		expect(palette.every((e) => HEX.test(e.hex))).toBe(true);
	});

	test.skipIf(!present)("fonts without COLR/CPAL yield an empty resolver", () => {
		const v1p50 = path.join(DATA_DIR, "v1", "fonts", "p50.ttf");
		if (!existsSync(v1p50)) return;
		const { resolve, palette } = buildTajweedResolver(readFileSync(v1p50));
		expect(resolve(String.fromCodePoint(0xfc41))).toBeNull();
		expect(palette).toEqual([]);
	});
});

// End-to-end through the real pipeline: the columns land in bounds.db with the right invariants.
for (const v of VERSIONS) {
	const present = hasAssets(v);
	describe(`tajweed metadata in bounds.db: ${v}`, () => {
		let rows: BoundRow[] = [];
		// Real render of the representative pages exceeds bun's default hook timeout.
		beforeAll(async () => {
			if (present) rows = await renderRepPages(v);
		}, 120_000);

		test.skipIf(!present)("word_index is always a real ayah word number (>= 1)", () => {
			expect(rows.filter((r) => r.wordIndex < 1)).toEqual([]);
		});

		test.skipIf(!present)("markers never carry a tajweed index", () => {
			expect(rows.filter((r) => r.isMarker === 1 && r.tajweedIndex !== null)).toEqual([]);
		});

		if (v === FontVersion.V4) {
			test.skipIf(!present)("V4 emits a small fixed set of numeric slot indices", () => {
				const indexed = rows.map((r) => r.tajweedIndex).filter((c): c is string => c !== null);
				expect(indexed.length).toBeGreaterThan(0);
				const slots = new Set<string>();
				for (const c of indexed) {
					expect(INDEX_LIST.test(c)).toBe(true); // only digits + commas
					for (const i of c.split(",")) slots.add(i);
				}
				expect(slots.size).toBeLessThanOrEqual(16); // fixed palette, not open-ended
			});
		} else {
			test.skipIf(!present)("V1/V2 tajweed_index is always null", () => {
				expect(rows.filter((r) => r.tajweedIndex !== null)).toEqual([]);
			});
		}
	});
}

// The generator writes the canonical palette table, and every per-glyph slot index resolves in it.
describe("tajweed_palette is populated and joinable (v4)", () => {
	const present = hasAssets(FontVersion.V4);

	test.skipIf(!present)(
		"palette covers every emitted slot index",
		async () => {
			const out = mkdtempSync(path.join(tmpdir(), "qig-pal-"));
			try {
				await generate({
					version: FontVersion.V4,
					mode: RenderMode.Page,
					format: ImageFormat.PNG,
					startPage: 50,
					endPage: 50,
					pages: [50],
					width: 1440,
					withMarkers: true,
					centerPages: false,
					centerText: false,
					showBounds: false,
					boundsJson: false,
					quantizeAlpha: false,
					colorSurahName: false,
					theme: "light",
					bench: false,
					engine: RenderEngine.Skia,
					markerScale: "6x",
					outputDir: out,
					dataDir: DATA_DIR,
				});
				const db = new Database(path.join(out, "v4", "1440", "png", "bounds.db"), { readonly: true });
				const palette = db.query("SELECT idx, hex FROM tajweed_palette").all() as { idx: number; hex: string }[];
				expect(palette.length).toBeGreaterThan(0);
				expect(palette.every((e) => HEX.test(e.hex))).toBe(true);
				const known = new Set(palette.map((e) => e.idx));

				const used = new Set<number>();
				for (const r of db
					.query("SELECT tajweed_index AS ti FROM glyph_bounds WHERE tajweed_index IS NOT NULL")
					.all() as {
					ti: string;
				}[]) {
					for (const i of r.ti.split(",")) used.add(Number(i));
				}
				expect(used.size).toBeGreaterThan(0);
				expect([...used].filter((i) => !known.has(i))).toEqual([]); // no dangling index
				db.close();
			} finally {
				rmSync(out, { recursive: true, force: true });
			}
		},
		120_000,
	);
});
