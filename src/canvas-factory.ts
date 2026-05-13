import type { RenderEngine } from "./types";

// Thin abstraction over @napi-rs/canvas (Skia, default) and canvas (Cairo, optional).
// Skia is statically linked and always available. Cairo is lazy-loaded — when the
// `canvas` package or its system libs aren't present, decorative rendering falls back
// to Skia (slight quality differences on ligature/COLR fonts, but no crash).

let engine: RenderEngine = "cairo";
let warned = false;
const warnCairoUnavailable = () => {
	if (warned) return;
	warned = true;
	console.warn("Cairo (canvas) unavailable — falling back to Skia for all rendering");
};

export const setEngine = (e: RenderEngine) => {
	engine = e;
};

export const getEngine = () => engine;

let _skia: typeof import("@napi-rs/canvas") | undefined;
type CairoModule = typeof import("canvas");
let _cairo: CairoModule | null | "unset" = "unset";

const getSkia = () => {
	_skia ??= require("@napi-rs/canvas");
	return _skia as typeof import("@napi-rs/canvas");
};

// Returns null when the `canvas` native module fails to load (missing dylibs,
// not bundled, etc.) instead of throwing — callers fall back to Skia.
const getCairo = (): CairoModule | null => {
	if (_cairo !== "unset") return _cairo;
	try {
		_cairo = require("canvas") as CairoModule;
	} catch {
		_cairo = null;
	}
	return _cairo;
};

export const cairoAvailable = () => getCairo() !== null;

export const createCanvas = (width: number, height: number) => {
	if (engine === "cairo") {
		const c = getCairo();
		if (c) return c.createCanvas(width, height);
		warnCairoUnavailable();
	}
	return getSkia().createCanvas(width, height);
};

export const registerFont = (fontPath: string, family: string) => {
	if (engine === "cairo") {
		const c = getCairo();
		if (c) {
			c.registerFont(fontPath, { family });
			return;
		}
		warnCairoUnavailable();
	}
	getSkia().GlobalFonts.registerFromPath(fontPath, family);
};

// Decorative rendering (surah names, headers, basmala) prefers Cairo for GSUB
// ligatures + COLR/CPAL handling, but transparently falls back to Skia.
export const createDecorativeCanvas = (width: number, height: number) => {
	const c = getCairo();
	if (c) return c.createCanvas(width, height);
	return getSkia().createCanvas(width, height);
};

export const registerDecorativeFont = (fontPath: string, family: string) => {
	const c = getCairo();
	if (c) {
		c.registerFont(fontPath, { family });
		return;
	}
	getSkia().GlobalFonts.registerFromPath(fontPath, family);
};
