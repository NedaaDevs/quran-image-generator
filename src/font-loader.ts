import { existsSync } from "node:fs";
import path from "node:path";
import { registerFont } from "./canvas-factory";
import type { FontVersion } from "./types";

// Surah name fonts use ligatures: "surah001" → calligraphic glyph
export const SURAH_NAME_FONT = "SurahName";
// Surah header font renders ornamental frame per surah via Unicode codepoints
export const SURAH_HEADER_FONT = "SurahHeader";
// Basmala uses page 1's QCF font — same calligraphic style as the page text
export const BASMALA_FONT = "Basmala";

const registeredFonts = new Set<string>();
// Cairo breaks when the same .ttf is registered under multiple family names
const registeredPaths = new Map<string, string>();

const register = (fontPath: string, family: string) => {
	if (registeredFonts.has(family)) return;
	const resolved = path.resolve(fontPath);
	if (!existsSync(resolved)) throw new Error(`Font not found: ${resolved}`);
	registerFont(resolved, family);
	registeredFonts.add(family);
	registeredPaths.set(resolved, family);
};

export const registerSurahFonts = (dataDir: string, version: FontVersion, colorSurahName = false) => {
	const colorPath = path.join(dataDir, "common", "fonts", `surah-name-${version}-color.ttf`);
	const regularPath = path.join(dataDir, "common", "fonts", `surah-name-${version}.ttf`);
	register(colorSurahName && existsSync(colorPath) ? colorPath : regularPath, SURAH_NAME_FONT);
	register(path.join(dataDir, "common", "fonts", "surah-header.ttf"), SURAH_HEADER_FONT);
	// Page 1 font contains basmala glyphs matching the version's calligraphic style
	register(path.join(dataDir, version, "fonts", "p1.ttf"), BASMALA_FONT);
};

export const registerPageFont = (fontsDir: string, page: number, version: FontVersion) => {
	const fontFamily = `${version}_p${page}`;
	const resolved = path.resolve(fontsDir, `p${page}.ttf`);

	// Reuse existing family if this file was already registered (e.g. p1.ttf as Basmala)
	const existing = registeredPaths.get(resolved);
	if (existing) return existing;

	if (!existsSync(resolved)) {
		throw new Error(`Font not found: ${resolved}`);
	}

	registerFont(resolved, fontFamily);
	registeredPaths.set(resolved, fontFamily);
	return fontFamily;
};
