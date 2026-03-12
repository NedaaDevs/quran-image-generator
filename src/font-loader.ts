import { GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "fs";
import path from "path";

export const registerPageFont = (fontsDir: string, page: number) => {
  const fontFamily = `p${page}`;
  const fontPath = path.join(fontsDir, `p${page}.ttf`);

  if (!existsSync(fontPath)) {
    throw new Error(`Font not found: ${fontPath}`);
  }

  GlobalFonts.registerFromPath(fontPath, fontFamily);
  return fontFamily;
};
