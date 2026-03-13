import { select, input, confirm } from "@inquirer/prompts";
import { existsSync } from "fs";
import path from "path";
import { FontVersion, ImageFormat, RenderMode } from "./types";
import type { GeneratorOptions } from "./generator";

const checkAssets = (dataDir: string, version: string): { common: boolean; version: boolean } => ({
  common: existsSync(path.join(dataDir, "common", "fonts")),
  version: existsSync(path.join(dataDir, version, "fonts", "p1.ttf")),
});

export const promptOptions = async (root: string): Promise<GeneratorOptions> => {
  const dataDir = path.join(root, "data");
  const outputDir = path.join(root, "output");

  const version = await select({
    message: "Font version:",
    choices: [
      { value: FontVersion.V1, name: "V1 — 1405H Madinah Mushaf" },
      { value: FontVersion.V2, name: "V2 — 1423H Madinah Mushaf" },
      { value: FontVersion.V4, name: "V4 — Tajweed (color glyphs)" },
    ],
  });

  const assets = checkAssets(dataDir, version);
  if (!assets.common || !assets.version) {
    const missing = [
      ...(!assets.common ? ["common"] : []),
      ...(!assets.version ? [version] : []),
    ];
    console.error(`\nMissing assets: ${missing.join(", ")}`);
    console.error("Download from GitHub releases and extract to data/");
    console.error("  https://github.com/nicosalm/quran-image-generator/releases/latest\n");

    const proceed = await confirm({ message: "Continue anyway?", default: false });
    if (!proceed) process.exit(0);
  }

  const mode = await select({
    message: "Output mode:",
    choices: [
      { value: RenderMode.Line, name: "Line — individual line images (15 per page)" },
      { value: RenderMode.Page, name: "Page — full page images" },
    ],
  });

  const width = Number(await input({ message: "Width (px):", default: "1440" }));

  const pageRange = await input({ message: "Page range (1-604):", default: "1-604" });
  const [startStr, endStr] = pageRange.includes("-") ? pageRange.split("-") : [pageRange, pageRange];
  const startPage = Number(startStr) || 1;
  const endPage = Number(endStr) || startPage;

  const format = await select({
    message: "Format:",
    choices: [
      { value: ImageFormat.PNG, name: "PNG" },
      { value: ImageFormat.WebP, name: "WebP" },
    ],
  });

  const withMarkers = await confirm({ message: "Include markers?", default: true });
  const quantizeAlpha = format === ImageFormat.PNG && await confirm({ message: "Quantize alpha? (smaller PNGs)", default: false });

  return {
    version,
    mode,
    format,
    startPage,
    endPage,
    width,
    withMarkers,
    showBounds: false,
    boundsJson: false,
    quantizeAlpha,
    outputDir,
    dataDir,
    onProgress: (page) => process.stdout.write(`\r  page ${page}/${endPage}`),
  };
};
