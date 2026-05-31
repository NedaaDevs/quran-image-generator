import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { patchCpalBaseInk } from "./font-palette";
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

// Dark theme: V4 base ink is a CPAL palette entry, not fillStyle, so it's patched when the
// font is registered. Default (unset) leaves registration untouched — light mode is unchanged.
let darkInk: string | undefined;
export const setDarkInk = (hex?: string) => {
	darkInk = hex;
};

let darkFontCounter = 0;
// Cairo can only register a font from a path, so patched data is written to a temp file;
// Skia accepts the patched buffer directly.
const patchToFile = (fontPath: string, family: string): string | null => {
	const patched = darkInk ? patchCpalBaseInk(readFileSync(fontPath), darkInk) : null;
	if (!patched) return null;
	const p = path.join(tmpdir(), `qig-dark-${family.replace(/\W/g, "_")}-${darkFontCounter++}.ttf`);
	writeFileSync(p, patched);
	return p;
};
const cairoRegister = (c: CairoModule, fontPath: string, family: string) => {
	c.registerFont(patchToFile(fontPath, family) ?? fontPath, { family });
};
const skiaRegister = (fontPath: string, family: string) => {
	const patched = darkInk ? patchCpalBaseInk(readFileSync(fontPath), darkInk) : null;
	if (patched) getSkia().GlobalFonts.register(patched, family);
	else getSkia().GlobalFonts.registerFromPath(fontPath, family);
};

export const registerFont = (fontPath: string, family: string) => {
	if (engine === "cairo") {
		const c = getCairo();
		if (c) {
			cairoRegister(c, fontPath, family);
			return;
		}
		warnCairoUnavailable();
	}
	skiaRegister(fontPath, family);
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
		cairoRegister(c, fontPath, family);
		return;
	}
	skiaRegister(fontPath, family);
};
