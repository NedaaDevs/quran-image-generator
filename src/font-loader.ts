import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "fs";
import path from "path";
import type { FontVersion } from "./types";

export const registerPageFont = (fontsDir: string, page: number, version: FontVersion) => {
  const fontFamily = `${version}_p${page}`;
  const fontPath = path.join(fontsDir, `p${page}.ttf`);

  if (!existsSync(fontPath)) {
    throw new Error(`Font not found: ${fontPath}`);
  }

  GlobalFonts.registerFromPath(fontPath, fontFamily);
  return fontFamily;
};
