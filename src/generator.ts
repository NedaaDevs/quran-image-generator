import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { losslessCompressPng } from "@napi-rs/image";

import { createBoundsDb, type LineMetadata } from "./bounds-db";
import { setEngine } from "./canvas-factory";
import { createDb, loadSurahMeta } from "./database";
import { registerPageFont, registerSurahFonts } from "./font-loader";
import {
	type MarkerScaleName,
	measurePage,
	QuranTheme,
	type QuranThemeName,
	renderBasmala,
	renderBlankLine,
	renderMarkerCircle,
	renderSurahFrame,
	renderSurahHeader,
	renderSurahName,
	setBasmalaText,
	setSurahNameGlyphs,
} from "./renderer";
import { renderFullPageV1, renderLineV1 } from "./renderer-v1";
import { renderFullPageV2, renderLineV2 } from "./renderer-v2";
import { renderFullPageV4, renderLineV4 } from "./renderer-v4";
import type { GlyphBounds } from "./types";
import { FontVersion, hPadding, ImageFormat, LINES_PER_PAGE, LineType, type RenderEngine, RenderMode } from "./types";

export interface GeneratorOptions {
	version: FontVersion;
	mode: RenderMode;
	format: ImageFormat;
	startPage: number;
	endPage: number;
	pages?: number[];
	width: number;
	withMarkers: boolean;
	centerPages: boolean;
	centerText: boolean;
	showBounds: boolean;
	boundsJson: boolean;
	quantizeAlpha: boolean;
	colorSurahName: boolean;
	pngquantBin?: string;
	bench: boolean;
	engine: RenderEngine;
	markerScale: MarkerScaleName;
	outputDir: string;
	dataDir: string;
	onProgress?: (page: number, total: number) => void;
}

export interface GeneratorResult {
	count: number;
	boundsCount: number;
}

export const generate = async (opts: GeneratorOptions): Promise<GeneratorResult> => {
	setEngine(opts.engine);
	const dbPath = path.join(opts.dataDir, opts.version, "quran-layout.db");
	const fontsDir = path.join(opts.dataDir, opts.version, "fonts");
	const db = createDb(dbPath);
	const surahMeta = loadSurahMeta(opts.dataDir, opts.version);
	registerSurahFonts(opts.dataDir, opts.version, opts.colorSurahName);

	// Basmala glyph codes from page 1 line 2 (ayah 1:1) — split markers to exclude ayah number
	const basWords = db.getLineGlyphs(1, 2, true);
	setBasmalaText(
		basWords
			.filter((w) => !w.isMarker)
			.map((w) => w.text_qpc)
			.join(""),
	);

	// Surah header font codepoint mapping (surah-N → Unicode glyph)
	const headerGlyphsPath = path.join(opts.dataDir, "common", "surah-header-ligatures.json");
	const headerGlyphs: Record<string, string> = JSON.parse(await Bun.file(headerGlyphsPath).text());

	// Color surah-name font uses direct codepoints instead of GSUB ligatures
	if (opts.colorSurahName) {
		const colorLigsPath = path.join(opts.dataDir, "common", "surah-name-color-ligatures.json");
		if (existsSync(colorLigsPath)) {
			setSurahNameGlyphs(JSON.parse(await Bun.file(colorLigsPath).text()));
		}
	}

	const fmt = opts.format;
	const ext = fmt === ImageFormat.WebP ? "webp" : "png";

	// pngquant reduces palette to 11 colors with no dithering — crisp text edges, smaller files
	const quantizePng = (buf: Buffer): Promise<Buffer> =>
		new Promise((resolve, reject) => {
			const child = execFile(
				opts.pngquantBin ?? "pngquant",
				["11", "--nofs", "--speed", "1", "-"],
				{ encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
				(err, stdout) => {
					if (err) return reject(err);
					resolve(stdout);
				},
			);
			child.stdin?.end(buf);
		});

	const perf = { render: 0, optimize: 0, write: 0, db: 0, font: 0 };
	const now = () => performance.now();

	const optimize = async (buf: Buffer) => {
		if (fmt !== ImageFormat.PNG) return buf;
		const t = now();
		const result = opts.quantizeAlpha ? await quantizePng(buf) : await losslessCompressPng(buf);
		perf.optimize += now() - t;
		return result;
	};

	const pad = (n: number, len: number) => String(n).padStart(len, "0");

	const fmtDir = path.join(opts.outputDir, opts.version, String(opts.width), ext);

	// Bounds written to SQLite for efficient per-page/ayah queries at runtime
	const boundsDbPath = path.join(fmtDir, "bounds.db");
	const boundsDb = createBoundsDb(boundsDbPath);
	boundsDb.begin();

	let count = 0;
	let boundsCount = 0;
	const jsonBounds: GlyphBounds[] = [];

	const allLineMetadata: LineMetadata[] = [];

	const pageSet = opts.pages ? new Set(opts.pages) : null;

	const renderLine =
		opts.version === FontVersion.V2 ? renderLineV2 : opts.version === FontVersion.V4 ? renderLineV4 : renderLineV1;
	const renderFullPage =
		opts.version === FontVersion.V2
			? renderFullPageV2
			: opts.version === FontVersion.V4
				? renderFullPageV4
				: renderFullPageV1;

	for (let page = opts.startPage; page <= opts.endPage; page++) {
		if (pageSet && !pageSet.has(page)) continue;
		boundsDb.clearPage(page);
		let t = now();
		const fontFamily = registerPageFont(fontsDir, page, opts.version);
		perf.font += now() - t;
		const lines = db.getPageLines(page);

		const lineInputs = lines.map((l) => ({
			...l,
			glyphs: db.getLineGlyphs(page, l.line, true),
		}));

		if (opts.mode === RenderMode.Page) {
			// Remap metadata to grid positions when centering (matches renderer's remapping)
			const hasHeaderGap = opts.centerPages && lines.length < LINES_PER_PAGE && lines[0]?.type === LineType.SurahHeader;
			const slots = hasHeaderGap ? lines.length + 1 : lines.length;
			const centerOffset = opts.centerPages && slots < LINES_PER_PAGE ? Math.floor((LINES_PER_PAGE - slots) / 2) : 0;
			for (const [i, l] of lines.entries()) {
				const surahNum = l.surah_number ?? undefined;
				const gridLine = l.line + centerOffset + (hasHeaderGap && i > 0 ? 1 : 0);
				allLineMetadata.push({
					page,
					line: gridLine,
					type: l.type,
					surahNumber: surahNum,
					surahName: l.type === LineType.SurahHeader && surahNum ? surahMeta[surahNum]?.name : undefined,
				});
			}
			const { buffer, bounds } = renderFullPage(
				fontFamily,
				lineInputs,
				opts.width,
				page,
				opts.withMarkers,
				opts.showBounds,
				headerGlyphs,
				fmt,
				opts.centerPages,
				opts.centerText,
			);
			const outDir = path.join(fmtDir, "pages");
			mkdirSync(outDir, { recursive: true });
			await Bun.write(path.join(outDir, `${pad(page, 3)}.${ext}`), await optimize(buffer));
			boundsDb.writeBounds(bounds);
			if (opts.boundsJson) jsonBounds.push(...bounds);
			boundsCount += bounds.length;
			count++;
		} else {
			const hPad = hPadding(opts.version);
			const contentWidth = hPad > 0 ? opts.width - 2 * hPad : undefined;
			const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(
				fontFamily,
				lineInputs,
				opts.width,
				contentWidth,
			);
			const outDir = path.join(fmtDir, "lines", pad(page, 3));
			mkdirSync(outDir, { recursive: true });

			const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
			const lineTypeMap = new Map(lines.map((l) => [l.line, l]));
			const blankImg = await optimize(renderBlankLine(opts.width, lineHeight, fmt));

			// When centerPages is on, center content vertically with a gap after surah header
			const hasHeaderGap = opts.centerPages && lines.length < LINES_PER_PAGE && lines[0]?.type === LineType.SurahHeader;
			const slots = hasHeaderGap ? lines.length + 1 : lines.length;
			const centerOffset = opts.centerPages && slots < LINES_PER_PAGE ? Math.floor((LINES_PER_PAGE - slots) / 2) : 0;
			const toSrcLine = (lineNum: number) => {
				const raw = lineNum - centerOffset;
				if (hasHeaderGap && raw === 2) return -1;
				return hasHeaderGap && raw > 2 ? raw - 1 : raw;
			};

			// Always output full grid — blank images for empty slots
			for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
				const srcLine = toSrcLine(lineNum);
				const ld = srcLine > 0 ? lineMap.get(srcLine) : undefined;
				const lineInfo = srcLine > 0 ? lineTypeMap.get(srcLine) : undefined;

				if (lineInfo) {
					const surahNum = lineInfo.surah_number ?? undefined;
					allLineMetadata.push({
						page,
						line: lineNum,
						type: lineInfo.type,
						surahNumber: surahNum,
						surahName: lineInfo.type === LineType.SurahHeader && surahNum ? surahMeta[surahNum]?.name : undefined,
					});
				}
				const filePath = path.join(outDir, `${pad(lineNum, 3)}.${ext}`);

				if (ld && ld.glyphs.length > 0) {
					t = now();
					const { buffer, bounds } = renderLine(
						fontFamily,
						fontSize,
						opts.width,
						{ lineHeight, ascent, descent },
						ld,
						opts.withMarkers,
						page,
						opts.showBounds,
						fmt,
						opts.centerText,
					);
					perf.render += now() - t;
					const optimized = await optimize(buffer);
					t = now();
					await Bun.write(filePath, optimized);
					perf.write += now() - t;
					t = now();
					for (const b of bounds) b.line = lineNum;
					boundsDb.writeBounds(bounds);
					perf.db += now() - t;
					if (opts.boundsJson) jsonBounds.push(...bounds);
					boundsCount += bounds.length;
				} else if (lineInfo?.type === LineType.SurahHeader && lineInfo.surah_number) {
					// With markers: frame + name; without: name only (frame is a theme asset)
					t = now();
					const hdr = opts.withMarkers
						? renderSurahHeader(opts.width, lineHeight, lineInfo.surah_number, headerGlyphs, fmt)
						: renderSurahName(opts.width, lineHeight, lineInfo.surah_number, fmt);
					perf.render += now() - t;
					const hdrOpt = await optimize(hdr);
					t = now();
					await Bun.write(filePath, hdrOpt);
					perf.write += now() - t;
				} else if (lineInfo?.type === LineType.Basmala) {
					t = now();
					const bas = renderBasmala(opts.width, lineHeight, fontSize, fmt);
					perf.render += now() - t;
					const basOpt = await optimize(bas);
					t = now();
					await Bun.write(filePath, basOpt);
					perf.write += now() - t;
				} else {
					await Bun.write(filePath, blankImg);
				}
				count++;
			}
		}

		opts.onProgress?.(page, opts.endPage - opts.startPage + 1);
	}

	boundsDb.writeLineMetadata(allLineMetadata);
	boundsDb.commit();
	boundsDb.close();

	if (opts.boundsJson && jsonBounds.length > 0) {
		const jsonPath = path.join(fmtDir, "bounds.json");
		await Bun.write(jsonPath, JSON.stringify(jsonBounds));
	}

	// Generate reusable marker templates (ornamental assets for theme overlays)
	const lineHeight = Math.round((opts.width * 232) / 1440);
	const markersDir = path.join(fmtDir, "markers");
	mkdirSync(markersDir, { recursive: true });
	await Bun.write(
		path.join(markersDir, `surah-frame.${ext}`),
		await optimize(renderSurahFrame(opts.width, lineHeight, headerGlyphs, fmt)),
	);

	// Generate themed marker circles (ornamental frame without numeral)
	const svgPath = path.join(opts.dataDir, opts.version, "marker-circle.svg");
	if (existsSync(svgPath)) {
		const svg = await Bun.file(svgPath).text();
		for (const theme of Object.keys(QuranTheme) as QuranThemeName[]) {
			const buf = renderMarkerCircle(svg, theme, opts.markerScale, fmt);
			await Bun.write(path.join(markersDir, `marker-${theme}.${ext}`), await optimize(buf));
		}
	}

	db.close();

	if (opts.bench) {
		const total = perf.font + perf.render + perf.optimize + perf.write + perf.db;
		const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
		console.log(
			`\n  Perf: font=${fmt(perf.font)} render=${fmt(perf.render)} optimize=${fmt(perf.optimize)} write=${fmt(perf.write)} db=${fmt(perf.db)} total=${fmt(total)}`,
		);
	}

	return { count, boundsCount };
};
