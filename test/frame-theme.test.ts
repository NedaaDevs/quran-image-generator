import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { generate } from "../src/generator";
import { QuranTheme, type QuranThemeName } from "../src/renderer";
import { FontVersion, ImageFormat, RenderEngine, RenderMode } from "../src/types";
import { DATA_DIR, hasAssets, WIDTH } from "./helpers";

// Themed surah-frame variants: the shared-pixel frame template alpha-mask tinted per
// QuranTheme (src/ornaments.ts primitives), matching the themed marker circles. These
// REPLACE the old untinted surah-frame.png — the themed files are the only frame artifact.
const V = FontVersion.V1;

const hexToRgb = (hex: string): [number, number, number] => {
	const v = Number.parseInt(hex.slice(1), 16);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

describe("themed surah-frame slots", () => {
	const present = hasAssets(V);
	const out = mkdtempSync(path.join(tmpdir(), "qig-frame-theme-"));
	afterAll(() => rmSync(out, { recursive: true, force: true }));

	beforeAll(async () => {
		if (!present) return;
		await generate({
			version: V,
			mode: RenderMode.Page,
			format: ImageFormat.PNG,
			startPage: 1,
			endPage: 1,
			pages: [1],
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
	}, 120_000);

	const markersDir = () => path.join(out, V, String(WIDTH), "png", "markers");

	test.skipIf(!present)("untinted surah-frame.png is no longer emitted", () => {
		expect(existsSync(path.join(markersDir(), "surah-frame.png"))).toBe(false);
	});

	for (const theme of Object.keys(QuranTheme) as QuranThemeName[]) {
		test.skipIf(!present)(`frame-${theme}.png is emitted at full line size`, async () => {
			const themed = await loadImage(path.join(markersDir(), `frame-${theme}.png`));
			expect(themed.width).toBe(WIDTH);
			expect(themed.height).toBe(Math.round((WIDTH * 232) / 1440));
		});

		test.skipIf(!present)(`frame-${theme}.png ink is exactly the theme's marker color`, async () => {
			const { createCanvas } = await import("@napi-rs/canvas");
			const img = await loadImage(path.join(markersDir(), `frame-${theme}.png`));
			const c = createCanvas(img.width, img.height);
			const ctx = c.getContext("2d");
			ctx.drawImage(img, 0, 0);
			const data = ctx.getImageData(0, 0, img.width, img.height).data;
			const [r, g, b] = hexToRgb(QuranTheme[theme].marker);

			// Exact ink holds for fully opaque pixels; anti-aliased edges shift slightly
			// through canvas premultiplied-alpha encode/decode rounding.
			let inkPixels = 0;
			for (let i = 0; i < data.length; i += 4) {
				if ((data[i + 3] as number) !== 255) continue;
				inkPixels++;
				expect(data[i]).toBe(r);
				expect(data[i + 1]).toBe(g);
				expect(data[i + 2]).toBe(b);
			}
			expect(inkPixels).toBeGreaterThan(0);
		});
	}
});
