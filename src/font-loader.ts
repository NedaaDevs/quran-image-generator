import { existsSync } from "node:fs";
import path from "node:path";
import { cairoAvailable, getEngine, registerDecorativeFont, registerFont } from "./canvas-factory";
import { sanitizeFontFile } from "./font-sanitizer";
import type { FontVersion } from "./types";

// Surah name fonts use ligatures: "surah001" → calligraphic glyph
export const SURAH_NAME_FONT = "SurahName";
// Surah header font renders ornamental frame per surah via Unicode codepoints
export const SURAH_HEADER_FONT = "SurahHeader";
export const QURAN_COMMON_FONT = "QuranCommon";
// Basmala uses page 1's QCF font — same calligraphic style as the page text
export const BASMALA_FONT = "Basmala";

// Decorative fonts always use Cairo (GSUB ligatures + COLR/CPAL color tables)
const cairoFamilies = new Set<string>();
// Cairo breaks when the same .ttf is registered under multiple family names
const cairoPaths = new Map<string, string>();

const registerDecorative = (fontPath: string, family: string) => {
	if (cairoFamilies.has(family)) return;
	const resolved = path.resolve(fontPath);
	if (!existsSync(resolved)) throw new Error(`Font not found: ${resolved}`);
	const existing = cairoPaths.get(resolved);
	if (existing) return;
	registerDecorativeFont(sanitizeFontFile(resolved), family);
	cairoFamilies.add(family);
	cairoPaths.set(resolved, family);
};

export const registerSurahFonts = (dataDir: string, version: FontVersion, colorSurahName = false) => {
	const colorPath = path.join(dataDir, "common", "fonts", `surah-name-${version}-color.ttf`);
	const regularPath = path.join(dataDir, "common", "fonts", `surah-name-${version}.ttf`);
	registerDecorative(colorSurahName && existsSync(colorPath) ? colorPath : regularPath, SURAH_NAME_FONT);
	registerDecorative(path.join(dataDir, "common", "fonts", "surah-header.ttf"), SURAH_HEADER_FONT);
	registerDecorative(path.join(dataDir, "common", "fonts", "quran-common.ttf"), QURAN_COMMON_FONT);
	// Page 1 font contains basmala glyphs matching the version's calligraphic style
	registerDecorative(path.join(dataDir, version, "fonts", "p1.ttf"), BASMALA_FONT);
};

// Page text fonts use the active engine (Skia for V4 color, Cairo for V1/V2)
const pageFamilies = new Set<string>();

export const registerPageFont = (fontsDir: string, page: number, version: FontVersion) => {
	const fontFamily = `${version}_p${page}`;
	const resolved = path.resolve(fontsDir, `p${page}.ttf`);

	if (getEngine() === "cairo" && cairoAvailable()) {
		// Reuse existing Cairo family if this file was already registered (e.g. p1.ttf as Basmala)
		const existing = cairoPaths.get(resolved);
		if (existing) return existing;
		registerFont(sanitizeFontFile(resolved), fontFamily);
		cairoPaths.set(resolved, fontFamily);
	} else {
		if (pageFamilies.has(fontFamily)) return fontFamily;
		if (!existsSync(resolved)) throw new Error(`Font not found: ${resolved}`);
		registerFont(sanitizeFontFile(resolved), fontFamily);
		pageFamilies.add(fontFamily);
	}

	return fontFamily;
};
