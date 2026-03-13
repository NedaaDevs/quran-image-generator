import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "fs";
import path from "path";
import type { FontVersion } from "./types";

// Surah name fonts use ligatures: "surah001" → calligraphic glyph
export const SURAH_NAME_FONT = "SurahName";
// Surah header font renders ornamental frame per surah via Unicode codepoints
export const SURAH_HEADER_FONT = "SurahHeader";
// Basmala uses page 1's QCF font — same calligraphic style as the page text
export const BASMALA_FONT = "Basmala";

const registeredFonts = new Set<string>();

const registerFont = (fontPath: string, family: string) => {
  if (registeredFonts.has(family)) return;
  if (!existsSync(fontPath)) throw new Error(`Font not found: ${fontPath}`);
  GlobalFonts.registerFromPath(fontPath, family);
  registeredFonts.add(family);
};

export const registerSurahFonts = (dataDir: string, version: FontVersion) => {
  registerFont(path.join(dataDir, "common", "fonts", `surah-name-${version}.ttf`), SURAH_NAME_FONT);
  registerFont(path.join(dataDir, "common", "fonts", "surah-header.ttf"), SURAH_HEADER_FONT);
  // Page 1 font contains basmala glyphs matching the version's calligraphic style
  registerFont(path.join(dataDir, version, "fonts", "p1.ttf"), BASMALA_FONT);
};

export const registerPageFont = (fontsDir: string, page: number, version: FontVersion) => {
  const fontFamily = `${version}_p${page}`;
  const fontPath = path.join(fontsDir, `p${page}.ttf`);

  if (!existsSync(fontPath)) {
    throw new Error(`Font not found: ${fontPath}`);
  }

  GlobalFonts.registerFromPath(fontPath, fontFamily);
  return fontFamily;
};
