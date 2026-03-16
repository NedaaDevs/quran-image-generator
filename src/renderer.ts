import { createCanvas } from "@napi-rs/canvas";
import { BASMALA_FONT, SURAH_HEADER_FONT, SURAH_NAME_FONT } from "./font-loader";
import { type GlyphBounds, ImageFormat, type LineInput, LineType, type MeasuredLine } from "./types";

// Canvas toBuffer accepts these mime types — cast needed because @napi-rs/canvas types are overly strict
export const toMime = (fmt: ImageFormat) => (fmt === ImageFormat.WebP ? "image/webp" : "image/png") as "image/webp";

// Arbitrary reference size for initial glyph measurement — actual fontSize is scaled from this
const REF_SIZE = 100;
// Shared offscreen context for text measurement (avoids creating canvases per call)
const mc = createCanvas(1, 1);
export const mx = mc.getContext("2d");

export type CanvasContext = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

export interface PageMetrics {
	lineData: MeasuredLine[];
	fontSize: number;
	lineHeight: number;
	ascent: number;
	descent: number;
}

export interface RenderLineResult {
	buffer: Buffer;
	bounds: GlyphBounds[];
}

export interface RenderPageResult {
	buffer: Buffer;
	bounds: GlyphBounds[];
}

// Measures all glyphs on a page and computes fontSize to fit the widest text line exactly.
export const measurePage = (
	fontFamily: string,
	lines: LineInput[],
	width: number,
	contentWidth?: number,
): PageMetrics => {
	// Measure at REF_SIZE first, then scale — gives us the ratio to fit widest line to canvas width
	mx.font = `${REF_SIZE}px "${fontFamily}"`;

	let maxRefWidth = 0;
	const lineData: MeasuredLine[] = lines.map((l) => {
		const measured = l.glyphs.map((g) => ({
			...g,
			w: mx.measureText(g.text_qpc).width,
		}));
		const total = measured.reduce((s, g) => s + g.w, 0);
		if (l.type === LineType.Text && total > maxRefWidth) maxRefWidth = total;
		return { ...l, glyphs: measured, total };
	});

	const fontSize = Math.floor(REF_SIZE * ((contentWidth ?? width) / maxRefWidth));
	mx.font = `${fontSize}px "${fontFamily}"`;

	// Page-wide ascent/descent ensures consistent baseline across all lines
	let pageAscent = 0;
	let pageDescent = 0;
	for (const ld of lineData) {
		for (const g of ld.glyphs) {
			const m = mx.measureText(g.text_qpc);
			pageAscent = Math.max(pageAscent, m.actualBoundingBoxAscent);
			pageDescent = Math.max(pageDescent, m.actualBoundingBoxDescent);
		}
	}

	// Standard Mushaf line height ratio — 232/1440 maintains correct vertical proportion
	const lineHeight = Math.round((width * 232) / 1440);

	return { lineData, fontSize, lineHeight, ascent: pageAscent, descent: pageDescent };
};

export const isSpecial = (type: LineType) => type === LineType.SurahHeader || type === LineType.Basmala;

// Set by generator after loading basmala glyph codes from DB (page 1, line 2)
let BASMALA_TEXT = "";
export const setBasmalaText = (text: string) => {
	BASMALA_TEXT = text;
};

// Direct codepoint lookup for surah names (used by color fonts that lack GSUB ligatures)
let surahNameGlyphs: Record<string, string> = {};
export const setSurahNameGlyphs = (glyphs: Record<string, string>) => {
	surahNameGlyphs = glyphs;
};

// Builds "سورة <name>" ligature text — v1/v4 need "surah-icon" prefix, v2 bakes it in
const surahNameText = (surahNumber: number, fontSize: number): string => {
	// Color fonts use direct codepoint mapping instead of GSUB ligatures
	const directGlyph = surahNameGlyphs[String(surahNumber)];
	if (directGlyph) return directGlyph;

	const name = `surah${String(surahNumber).padStart(3, "0")}`;
	mx.font = `${fontSize}px "${SURAH_NAME_FONT}"`;
	const iconW = mx.measureText("surah-icon").width;
	// Ligature glyph is compact (~1.3x fontSize); missing glyph renders individual chars (~5x)
	// Name before icon — ligatures produce Arabic glyphs which render RTL naturally
	return iconW > 0 && iconW < fontSize * 2 ? `${name} surah-icon` : name;
};

// --- Shared decorative renderers (version-independent) ---

// Composites ornamental frame + version-matched surah name (ligature font)
export const renderSurahHeader = (
	width: number,
	lineHeight: number,
	surahNumber: number,
	headerGlyphs: Record<string, string>,
	format: ImageFormat = ImageFormat.PNG,
): Buffer => {
	const canvas = createCanvas(width, lineHeight);
	const ctx = canvas.getContext("2d");

	const glyph = headerGlyphs[`surah-${surahNumber}`];
	if (glyph) {
		// Frame font renders ornamental border + surah name as one glyph
		mx.font = `100px "${SURAH_HEADER_FONT}"`;
		const refW = mx.measureText(glyph.trim()).width;
		const fontSize = Math.floor((100 * width) / refW);
		ctx.font = `${fontSize}px "${SURAH_HEADER_FONT}"`;
		ctx.fillStyle = "#000000";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(glyph.trim(), width / 2, lineHeight / 2);
	}

	return canvas.toBuffer(toMime(format));
};

// Renders version-matched surah name as standalone line image
export const renderSurahName = (
	width: number,
	lineHeight: number,
	surahNumber: number,
	format: ImageFormat = ImageFormat.PNG,
): Buffer => {
	const canvas = createCanvas(width, lineHeight);
	const ctx = canvas.getContext("2d");
	const fontSize = Math.floor(lineHeight * 0.65);
	ctx.font = `${fontSize}px "${SURAH_NAME_FONT}"`;
	ctx.fillStyle = "#000000";
	ctx.textBaseline = "middle";
	ctx.textAlign = "center";
	ctx.direction = "rtl";
	ctx.fillText(surahNameText(surahNumber, fontSize), width / 2, lineHeight / 2);
	return canvas.toBuffer(toMime(format));
};

// Extracts the ornamental frame by diffing 3 surah headers to isolate shared pixels
export const renderSurahFrame = (
	width: number,
	lineHeight: number,
	headerGlyphs: Record<string, string>,
	format: ImageFormat = ImageFormat.PNG,
): Buffer => {
	const render = (key: string) => {
		const glyph = (headerGlyphs[key] ?? "").trim();
		mx.font = `100px "${SURAH_HEADER_FONT}"`;
		const refW = mx.measureText(glyph).width;
		const fontSize = Math.floor((100 * width) / refW);
		const c = createCanvas(width, lineHeight);
		const ctx = c.getContext("2d");
		ctx.font = `${fontSize}px "${SURAH_HEADER_FONT}"`;
		ctx.fillStyle = "#000000";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(glyph, width / 2, lineHeight / 2);
		return ctx.getImageData(0, 0, width, lineHeight).data;
	};

	// 3 surahs with different name lengths for clean extraction
	const d1 = render("surah-1");
	const d2 = render("surah-10");
	const d3 = render("surah-19");

	const c = createCanvas(width, lineHeight);
	const ctx = c.getContext("2d");
	const imgData = ctx.createImageData(width, lineHeight);
	for (let i = 0; i < d1.length; i += 4) {
		if (
			d1[i] === d2[i] &&
			d2[i] === d3[i] &&
			d1[i + 1] === d2[i + 1] &&
			d2[i + 1] === d3[i + 1] &&
			d1[i + 2] === d2[i + 2] &&
			d2[i + 2] === d3[i + 2] &&
			d1[i + 3] === d2[i + 3] &&
			d2[i + 3] === d3[i + 3]
		) {
			imgData.data[i] = d1[i] ?? 0;
			imgData.data[i + 1] = d1[i + 1] ?? 0;
			imgData.data[i + 2] = d1[i + 2] ?? 0;
			imgData.data[i + 3] = d1[i + 3] ?? 0;
		}
	}
	ctx.putImageData(imgData, 0, 0);
	return c.toBuffer(toMime(format));
};

// Renders basmala centered using QCF page 1 font glyphs — matches the version's calligraphic style
export const renderBasmala = (
	width: number,
	lineHeight: number,
	fontSize: number,
	format: ImageFormat = ImageFormat.PNG,
): Buffer => {
	const canvas = createCanvas(width, lineHeight);
	const ctx = canvas.getContext("2d");
	ctx.font = `${fontSize}px "${BASMALA_FONT}"`;
	ctx.fillStyle = "#000000";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.direction = "rtl";
	ctx.fillText(BASMALA_TEXT, width / 2, lineHeight / 2);
	return canvas.toBuffer(toMime(format));
};

// Blank transparent image at the standard line dimensions — used for empty slots in the 15-line grid
export const renderBlankLine = (width: number, lineHeight: number, format: ImageFormat = ImageFormat.PNG): Buffer =>
	createCanvas(width, lineHeight).toBuffer(toMime(format));

// Draws surah header or basmala onto a page canvas at the given y offset
export const drawDecorativeLine = (
	ctx: CanvasContext,
	lineInfo: LineInput,
	fontSize: number,
	width: number,
	lineHeight: number,
	y: number,
	withMarkers: boolean,
	headerGlyphs: Record<string, string>,
) => {
	if (lineInfo.type === LineType.SurahHeader && lineInfo.surah_number) {
		if (withMarkers) {
			const glyph = headerGlyphs[`surah-${lineInfo.surah_number}`];
			if (glyph) {
				mx.font = `100px "${SURAH_HEADER_FONT}"`;
				const refW = mx.measureText(glyph.trim()).width;
				const hdrSize = Math.floor((100 * width) / refW);
				ctx.font = `${hdrSize}px "${SURAH_HEADER_FONT}"`;
				ctx.fillStyle = "#000000";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(glyph.trim(), width / 2, y + lineHeight / 2);
			}
		} else {
			const nameFontSize = Math.floor(lineHeight * 0.45);
			ctx.font = `${nameFontSize}px "${SURAH_NAME_FONT}"`;
			ctx.fillStyle = "#000000";
			ctx.textBaseline = "middle";
			ctx.textAlign = "center";
			ctx.direction = "rtl";
			ctx.fillText(surahNameText(lineInfo.surah_number, nameFontSize), width / 2, y + lineHeight / 2);
		}
	} else if (lineInfo.type === LineType.Basmala) {
		ctx.font = `${fontSize}px "${BASMALA_FONT}"`;
		ctx.fillStyle = "#000000";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.direction = "rtl";
		ctx.fillText(BASMALA_TEXT, width / 2, y + lineHeight / 2);
	}
};

// Themed marker circle sizes (3:4 aspect ratio matching Ayah app convention)
export const MarkerScale = {
	"3x": { w: 180, h: 240 },
	"6x": { w: 360, h: 480 },
} as const;

export type MarkerScaleName = keyof typeof MarkerScale;

export const QuranTheme = {
	light: { marker: "#B8860B", bg: "#FFFDF7" },
	sepia: { marker: "#8B6914", bg: "#F8F1E3" },
	dark: { marker: "#C4A265", bg: "#121212" },
} as const;

export type QuranThemeName = keyof typeof QuranTheme;

// Renders an ornamental marker circle (numeral removed) from an SVG path
export const renderMarkerCircle = (
	svg: string,
	theme: QuranThemeName,
	scale: MarkerScaleName,
	format: ImageFormat,
): Buffer => {
	const { w, h } = MarkerScale[scale];
	const color = QuranTheme[theme].marker;
	const colored = svg.replace("currentColor", color);
	const canvas = createCanvas(w, h);
	const ctx = canvas.getContext("2d");
	const { Image } = require("@napi-rs/canvas");
	const img = new Image();
	img.src = Buffer.from(colored);
	ctx.drawImage(img, 0, 0, w, h);
	return canvas.toBuffer(toMime(format));
};

// Draw bounds visualization rectangles
export const drawBoundsOverlay = (ctx: CanvasContext, bounds: GlyphBounds[]) => {
	for (const [i, b] of bounds.entries()) {
		ctx.fillStyle = i % 2 === 0 ? "rgba(255,0,0,0.25)" : "rgba(0,0,255,0.25)";
		ctx.fillRect(b.x, b.y, b.width, b.height);
	}
};
