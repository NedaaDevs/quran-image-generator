import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BoundRow, DIMENSIONS, hasAssets, PAD, renderRepPages, VERSIONS, WIDTH } from "./helpers";

// Layer 2 (geometry invariants) + Layer 3 (golden snapshots). Both need a render, so the pages
// are rendered once per (version, width) and shared. Guards the justification-regression class
// of bug, and that bounds stay valid at every shipped render dimension (markers included).

const GOLDEN_DIR = path.join(import.meta.dir, "__golden__");
const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === "1";
// Goldens are blessed locally (Cairo on dev); rasterizer metrics differ slightly across
// engines/OSes, so skip the exact comparison in environments that didn't bless them.
const SKIP_GOLDENS = process.env.SKIP_GOLDENS === "1";
const GEOM_TOL = Number(process.env.GOLDEN_TOL ?? 2);

const byLine = (rows: BoundRow[]) => {
	const m = new Map<string, BoundRow[]>();
	for (const r of rows) {
		const k = `${r.page}:${r.line}`;
		const arr = m.get(k);
		if (arr) arr.push(r);
		else m.set(k, [r]);
	}
	return m;
};

// Geometry invariants that must hold at every render width. Bounds are absolute pixels in the
// image's own space, so the right edge tracks width - PAD (not a fixed 1400).
for (const v of VERSIONS) {
	const present = hasAssets(v);
	for (const width of DIMENSIONS) {
		const rightEdge = width - PAD;
		describe(`render invariants: ${v} @${width}`, () => {
			let rows: BoundRow[] = [];
			// Rendering the representative pages through the real pipeline takes well over bun's
			// default 5s hook timeout.
			beforeAll(async () => {
				if (present) rows = await renderRepPages(v, width);
			}, 120_000);

			// No glyph may render outside the canvas (catches markers overflowing a too-narrow line).
			// Small grace absorbs sub-pixel rasterizer differences; real overflow is tens of px.
			test.skipIf(!present)("no glyph off-canvas", () => {
				const bad = rows.filter((r) => r.x < -GEOM_TOL || r.x + r.width > width + GEOM_TOL);
				expect(bad).toEqual([]);
			});

			// Every text line is right-aligned to width - pad. A line that fails this lost its
			// justification (the font-shrink regression left lines short of the right edge too).
			test.skipIf(!present)("every text line aligns to the right edge", () => {
				const offenders: string[] = [];
				for (const [k, line] of byLine(rows)) {
					const right = Math.max(...line.map((r) => r.x + r.width));
					if (Math.abs(right - rightEdge) > GEOM_TOL) offenders.push(`${k} right=${right}`);
				}
				expect(offenders).toEqual([]);
			});

			// Markers carry no drawn glyph — only the reserved box the marker overlay sizes itself to.
			// At any width that box must exist (count stable) and stay non-zero and on-canvas.
			test.skipIf(!present)("markers keep a valid on-canvas box", () => {
				const markers = rows.filter((r) => r.isMarker === 1);
				const bad = markers.filter(
					(r) => r.width <= 0 || r.height <= 0 || r.x < -GEOM_TOL || r.x + r.width > width + GEOM_TOL,
				);
				expect(bad).toEqual([]);
				expect(markers.length).toBeGreaterThan(0);
			});

			test.skipIf(!present)("renders a non-trivial number of glyphs", () => {
				expect(rows.length).toBeGreaterThan(500);
			});
		});
	}
}

// Layer 3 — golden snapshot, blessed at WIDTH only (geometry is width-specific; the per-dimension
// invariants above cover the other widths).
for (const v of VERSIONS) {
	const present = hasAssets(v);
	describe(`golden snapshot: ${v}`, () => {
		let rows: BoundRow[] = [];
		beforeAll(async () => {
			if (present) rows = await renderRepPages(v, WIDTH);
		}, 120_000);

		// Structural fields must match exactly; geometry within a few px. Re-bless with
		// UPDATE_GOLDENS=1 after an intentional layout change.
		test.skipIf(!present || SKIP_GOLDENS)("bounds match golden snapshot", () => {
			const file = path.join(GOLDEN_DIR, `${v}.json`);
			if (UPDATE_GOLDENS) {
				mkdirSync(GOLDEN_DIR, { recursive: true });
				writeFileSync(file, `${JSON.stringify(rows)}\n`);
				return;
			}
			expect(existsSync(file)).toBe(true);
			const golden = JSON.parse(readFileSync(file, "utf8")) as BoundRow[];
			expect(rows.length).toBe(golden.length);

			const diffs: string[] = [];
			for (let i = 0; i < golden.length && diffs.length < 10; i++) {
				const a = rows[i];
				const g = golden[i];
				if (!a || !g) continue;
				// Identity must match exactly
				if (a.page !== g.page || a.line !== g.line || a.position !== g.position || a.isMarker !== g.isMarker) {
					diffs.push(
						`#${i} identity drift: got ${a.page}:${a.line}:${a.position}(m${a.isMarker}) want ${g.page}:${g.line}:${g.position}(m${g.isMarker})`,
					);
					continue;
				}
				if (a.surah !== g.surah || a.ayah !== g.ayah) {
					diffs.push(
						`#${i} ayah drift @${a.page}:${a.line}:${a.position}: got ${a.surah}:${a.ayah} want ${g.surah}:${g.ayah}`,
					);
					continue;
				}
				for (const f of ["x", "y", "width", "height"] as const) {
					if (Math.abs(a[f] - g[f]) > GEOM_TOL) {
						diffs.push(`#${i} ${f} @${a.page}:${a.line}:${a.position}: got ${a[f]} want ${g[f]} (±${GEOM_TOL})`);
					}
				}
			}
			expect(diffs).toEqual([]);
		});
	});
}
