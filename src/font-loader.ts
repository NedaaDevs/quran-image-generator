import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "fs";
import path from "path";
import type { FontVersion } from "./types";

// Surah name fonts use ligatures: "surah001" → calligraphic glyph
export const SURAH_NAME_FONT = "SurahName";
// Surah header font renders ornamental frame per surah via Unicode codepoints
export const SURAH_HEADER_FONT = "SurahHeader";

const registeredFonts = new Set<string>();

const registerFont = (fontPath: string, family: string) => {
  if (registeredFonts.has(family)) return;
  if (!existsSync(fontPath)) throw new Error(`Font not found: ${fontPath}`);
  GlobalFonts.registerFromPath(fontPath, family);
  registeredFonts.add(family);
};

// TODO: check if QPC page fonts have basmala glyphs — may be able to drop UthmanicHafs
export const BASMALA_FONT = "UthmanicHafs";

export const registerSurahFonts = (dataDir: string, version: FontVersion) => {
  registerFont(path.join(dataDir, "fonts", `surah-name-${version}.ttf`), SURAH_NAME_FONT);
  registerFont(path.join(dataDir, "fonts", "surah-header.ttf"), SURAH_HEADER_FONT);
  registerFont(path.join(dataDir, "fonts", "UthmanicHafs.ttf"), BASMALA_FONT);
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
