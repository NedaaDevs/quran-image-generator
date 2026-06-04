import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generate } from "../src/generator";
import { FontVersion, ImageFormat, RenderEngine, RenderMode } from "../src/types";

export const ROOT = path.join(import.meta.dir, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const VERSIONS = [FontVersion.V1, FontVersion.V2, FontVersion.V4] as const;

export const TOTAL_AYAHS = 6236;
export const WIDTH = 1440;
export const PAD = 40; // hPadding is 40 for all versions; right edge = WIDTH - PAD

// Representative pages exercised by the render/golden tests:
//   1   Al-Fatiha — basmala + centered opening page
//   50  a dense interior page (all 15 lines full)
//   254 a mid-surah line-spilled marker (Ar-Ra'd)
//   293 surah header + basmala + a line-spilled marker (Al-Kahf 18:1)
//   294 the page that surfaced the marker-drop and justification regressions
//   604 final page — short closing surahs
export const REP_PAGES = [1, 50, 254, 293, 294, 604];

export const layoutPath = (v: FontVersion) => path.join(DATA_DIR, v, "quran-layout.db");

// Render/layout tests need the downloaded assets (gitignored). Skip cleanly when absent
// (e.g. the lint/typecheck CI job that doesn't fetch them).
export const hasAssets = (v: FontVersion): boolean =>
	existsSync(layoutPath(v)) &&
	existsSync(path.join(DATA_DIR, v, "fonts", "p1.ttf")) &&
	existsSync(path.join(DATA_DIR, "common"));

export const openLayout = (v: FontVersion) => new Database(layoutPath(v), { readonly: true });

export interface BoundRow {
	page: number;
	line: number;
	position: number;
	surah: number;
	ayah: number;
	x: number;
	y: number;
	width: number;
	height: number;
	isMarker: number;
}

// Drive the real generate() pipeline (same path the shipped bounds.db comes from) over the
// representative pages into a throwaway dir, then return their bounds rows. Engine matches the
// CLI default — Cairo for V1/V2; generate() forces Skia for V4 (needs COLR/CPAL).
export const renderRepPages = async (v: FontVersion): Promise<BoundRow[]> => {
	const out = mkdtempSync(path.join(tmpdir(), `qig-test-${v}-`));
	try {
		await generate({
			version: v,
			mode: RenderMode.Page,
			format: ImageFormat.PNG,
			startPage: Math.min(...REP_PAGES),
			endPage: Math.max(...REP_PAGES),
			pages: REP_PAGES,
			width: WIDTH,
			withMarkers: true,
			centerPages: false,
			centerText: false,
			showBounds: false,
			boundsJson: false,
			quantizeAlpha: false,
			colorSurahName: false,
			theme: "light",
			bench: false,
			engine: RenderEngine.Cairo,
			markerScale: "6x",
			outputDir: out,
			dataDir: DATA_DIR,
		});
		const db = new Database(path.join(out, v, String(WIDTH), "png", "bounds.db"), { readonly: true });
		const rows = db
			.query(
				`SELECT page, line, position, surah_number AS surah, ayah_number AS ayah,
				        x, y, width, height, is_marker AS isMarker
				 FROM glyph_bounds ORDER BY page, line, position, is_marker`,
			)
			.all() as BoundRow[];
		db.close();
		return rows;
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
};
