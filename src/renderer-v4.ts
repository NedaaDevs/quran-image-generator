import { createCanvas } from "./canvas-factory";
import {
	drawBoundsOverlay,
	drawLineJustified,
	measurePage,
	type PageMetrics,
	type RenderLineResult,
	type RenderPageResult,
	renderDecorativePixels,
	toMime,
} from "./renderer";
import {
	FontVersion,
	type GlyphBounds,
	hPadding,
	ImageFormat,
	LINES_PER_PAGE,
	type LineInput,
	LineType,
	type MeasuredLine,
} from "./types";

// V4: Tajweed-colored fonts with V1 justified layout.
// Layout: identical to V1 (8,820 lines, zero diff). Glyph codes: V2 range (U+FC41).
// Color: V4 fonts embed COLR/CPAL tables — tajweed colors render regardless of fillStyle.
// Cairo ignores COLR/CPAL, so V4 must run on Skia (enforced in generator).

export const renderLineV4 = (
	fontFamily: string,
	fontSize: number,
	width: number,
	metrics: Pick<PageMetrics, "lineHeight" | "ascent" | "descent">,
	ld: MeasuredLine,
	withMarkers = false,
	page = 0,
	showBounds = false,
	format: ImageFormat = ImageFormat.PNG,
	centerText = false,
): RenderLineResult => {
	const canvas = createCanvas(width, metrics.lineHeight);
	const ctx = canvas.getContext("2d");

	const baseline = Math.floor((metrics.lineHeight + metrics.ascent - metrics.descent) / 2);
	const bounds = drawLineJustified(
		ctx,
		fontFamily,
		fontSize,
		width,
		hPadding(FontVersion.V4),
		ld,
		baseline,
		page,
		withMarkers,
		centerText,
	);

	if (showBounds) drawBoundsOverlay(ctx, bounds);

	return { buffer: canvas.toBuffer(toMime(format)), bounds };
};

export const renderFullPageV4 = (
	fontFamily: string,
	lines: LineInput[],
	width: number,
	page: number,
	withMarkers = false,
	showBounds = false,
	headerGlyphs: Record<string, string> = {},
	format: ImageFormat = ImageFormat.PNG,
	centerPages = false,
	centerText = false,
): RenderPageResult => {
	const pad = hPadding(FontVersion.V4);
	const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(fontFamily, lines, width, width - 2 * pad);
	const height = LINES_PER_PAGE * lineHeight;

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");

	const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
	const lineTypeMap = new Map(lines.map((l) => [l.line, l]));
	const allBounds: GlyphBounds[] = [];

	// When centering, add blank gap after surah header on pages with < 15 lines
	const hasHeaderGap = centerPages && lines.length < LINES_PER_PAGE && lines[0]?.type === LineType.SurahHeader;
	const slots = hasHeaderGap ? lines.length + 1 : lines.length;
	const centerOffset = centerPages && slots < LINES_PER_PAGE ? Math.floor((LINES_PER_PAGE - slots) / 2) : 0;
	const toSrcLine = (lineNum: number) => {
		const raw = lineNum - centerOffset;
		if (hasHeaderGap && raw === 2) return -1;
		return hasHeaderGap && raw > 2 ? raw - 1 : raw;
	};

	for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
		const srcLine = toSrcLine(lineNum);
		if (srcLine < 0) continue;
		const ld = lineMap.get(srcLine);
		const lineInfo = lineTypeMap.get(srcLine);
		const y = (lineNum - 1) * lineHeight;

		ctx.save();

		if (ld && ld.glyphs.length > 0) {
			const baseline = y + Math.floor((lineHeight + ascent - descent) / 2);
			const bounds = drawLineJustified(
				ctx,
				fontFamily,
				fontSize,
				width,
				hPadding(FontVersion.V4),
				ld,
				baseline,
				page,
				withMarkers,
				centerText,
			);
			for (const b of bounds) {
				b.line = lineNum;
				allBounds.push(b);
			}
		} else if (lineInfo) {
			// Decorative fonts are Cairo-only — render pixels with Cairo, paste onto Skia canvas
			const pixels = renderDecorativePixels(lineInfo, fontSize, width, lineHeight, withMarkers, headerGlyphs);
			if (pixels) {
				const imgData = ctx.createImageData(width, lineHeight);
				imgData.data.set(pixels);
				ctx.putImageData(imgData, 0, y);
			}
		}

		ctx.restore();
	}

	if (showBounds) drawBoundsOverlay(ctx, allBounds);

	return { buffer: canvas.toBuffer(toMime(format)), bounds: allBounds };
};
