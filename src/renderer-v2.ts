import { createCanvas } from "@napi-rs/canvas";
import {
	type CanvasContext,
	drawBoundsOverlay,
	drawDecorativeLine,
	measurePage,
	mx,
	type PageMetrics,
	type RenderLineResult,
	type RenderPageResult,
	toMime,
} from "./renderer";
import { type GlyphBounds, ImageFormat, LINES_PER_PAGE, type LineInput, type MeasuredLine } from "./types";

// Positions each glyph individually in a centered block on the canvas.
// Marker widths are always included in the layout so gaps are preserved
// even when markers aren't drawn — prevents word collisions at ayah boundaries.
const drawLineCentered = (
	ctx: CanvasContext,
	fontFamily: string,
	fontSize: number,
	width: number,
	ld: MeasuredLine,
	baseline: number,
	page: number,
	withMarkers: boolean,
): GlyphBounds[] => {
	ctx.font = `${fontSize}px "${fontFamily}"`;
	ctx.textAlign = "left";
	ctx.fillStyle = "#000000";
	ctx.textBaseline = "alphabetic";
	mx.font = `${fontSize}px "${fontFamily}"`;

	const glyphs = ld.glyphs.map((g) => ({
		...g,
		w: mx.measureText(g.text_qpc).width,
	}));
	const total = glyphs.reduce((s, g) => s + g.w, 0);
	const shouldDraw = (g: { isMarker?: boolean }) => !g.isMarker || withMarkers;

	const bounds: GlyphBounds[] = [];
	let x = (width + total) / 2;
	for (const g of glyphs) {
		x -= g.w;
		if (shouldDraw(g)) ctx.fillText(g.text_qpc, x, baseline);
		const gm = mx.measureText(g.text_qpc);
		bounds.push({
			page,
			line: ld.line,
			position: g.position,
			surahNumber: g.surahNumber,
			ayahNumber: g.ayahNumber,
			x: Math.round(x),
			y: Math.round(baseline - gm.actualBoundingBoxAscent),
			width: Math.round(g.w),
			height: Math.round(gm.actualBoundingBoxAscent + gm.actualBoundingBoxDescent),
			isMarker: g.isMarker ?? false,
		});
	}

	return bounds;
};

export const renderLineV2 = (
	fontFamily: string,
	fontSize: number,
	width: number,
	metrics: Pick<PageMetrics, "lineHeight" | "ascent" | "descent">,
	ld: MeasuredLine,
	withMarkers = false,
	page = 0,
	showBounds = false,
	format: ImageFormat = ImageFormat.PNG,
): RenderLineResult => {
	const canvas = createCanvas(width, metrics.lineHeight);
	const ctx = canvas.getContext("2d");

	const baseline = Math.floor((metrics.lineHeight + metrics.ascent - metrics.descent) / 2);
	const bounds = drawLineCentered(ctx, fontFamily, fontSize, width, ld, baseline, page, withMarkers);

	if (showBounds) drawBoundsOverlay(ctx, bounds);

	return { buffer: canvas.toBuffer(toMime(format)), bounds };
};

export const renderFullPageV2 = (
	fontFamily: string,
	lines: LineInput[],
	width: number,
	page: number,
	withMarkers = false,
	showBounds = false,
	headerGlyphs: Record<string, string> = {},
	format: ImageFormat = ImageFormat.PNG,
): RenderPageResult => {
	const { lineData, fontSize, lineHeight, ascent, descent } = measurePage(fontFamily, lines, width);
	const height = LINES_PER_PAGE * lineHeight;

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");

	const lineMap = new Map(lineData.map((ld) => [ld.line, ld]));
	const lineTypeMap = new Map(lines.map((l) => [l.line, l]));
	const allBounds: GlyphBounds[] = [];

	// Center content vertically on pages with fewer than 15 lines (e.g. pages 1-2)
	const centerOffset = lines.length < LINES_PER_PAGE ? Math.floor((LINES_PER_PAGE - lines.length) / 2) : 0;

	for (let lineNum = 1; lineNum <= LINES_PER_PAGE; lineNum++) {
		const srcLine = lineNum - centerOffset;
		const ld = lineMap.get(srcLine);
		const lineInfo = lineTypeMap.get(srcLine);
		const y = (lineNum - 1) * lineHeight;

		ctx.save();

		if (ld && ld.glyphs.length > 0) {
			const baseline = y + Math.floor((lineHeight + ascent - descent) / 2);
			const bounds = drawLineCentered(ctx, fontFamily, fontSize, width, ld, baseline, page, withMarkers);
			// drawLineCentered records ld.line — remap to output grid position
			for (const b of bounds) {
				b.line = lineNum;
				allBounds.push(b);
			}
		} else if (lineInfo) {
			drawDecorativeLine(ctx, lineInfo, fontSize, width, lineHeight, y, withMarkers, headerGlyphs);
		}

		ctx.restore();
	}

	if (showBounds) drawBoundsOverlay(ctx, allBounds);

	return { buffer: canvas.toBuffer(toMime(format)), bounds: allBounds };
};
