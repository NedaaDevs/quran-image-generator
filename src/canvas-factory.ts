import type { RenderEngine } from "./types";

// Thin abstraction over @napi-rs/canvas (Skia) and canvas (Cairo)
// Cairo produces thinner strokes closer to printed Mushaf rendering

let engine: RenderEngine = "cairo";

export const setEngine = (e: RenderEngine) => {
	engine = e;
};

export const getEngine = () => engine;

// Lazy-loaded modules to avoid importing both at startup
let _skia: typeof import("@napi-rs/canvas") | undefined;
let _cairo: typeof import("canvas") | undefined;

const getSkia = () => {
	_skia ??= require("@napi-rs/canvas");
	return _skia as typeof import("@napi-rs/canvas");
};

const getCairo = () => {
	_cairo ??= require("canvas");
	return _cairo as typeof import("canvas");
};

export const createCanvas = (width: number, height: number) => {
	if (engine === "cairo") return getCairo().createCanvas(width, height);
	return getSkia().createCanvas(width, height);
};

export const registerFont = (fontPath: string, family: string) => {
	if (engine === "cairo") {
		getCairo().registerFont(fontPath, { family });
	} else {
		getSkia().GlobalFonts.registerFromPath(fontPath, family);
	}
};

// Cairo-specific functions for decorative rendering (surah names, headers, basmala).
// These fonts rely on GSUB ligatures or COLR/CPAL tables that Skia doesn't fully support.
export const createCairoCanvas = (width: number, height: number) => getCairo().createCanvas(width, height);

export const registerCairoFont = (fontPath: string, family: string) => {
	getCairo().registerFont(fontPath, { family });
};
