import { select, input, confirm } from "@inquirer/prompts";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import path from "path";
import { FontVersion, ImageFormat, RenderMode } from "./types";
import type { GeneratorOptions } from "./generator";

const REPO = "NedaaDevs/quran-image-generator";
const RELEASE_URL = `https://github.com/${REPO}/releases/download/assets`;

const checkAssets = (dataDir: string, version: string): { common: boolean; version: boolean } => ({
  common: existsSync(path.join(dataDir, "common", "fonts")),
  version: existsSync(path.join(dataDir, version, "fonts", "p1.ttf")),
});

const downloadAndExtract = async (url: string, destDir: string) => {
  console.log(`  Downloading ${url}...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const tmpZip = path.join(destDir, "_tmp.zip");
  await Bun.write(tmpZip, await res.arrayBuffer());

  const proc = Bun.spawn(["unzip", "-o", "-q", tmpZip, "-d", destDir], { stdout: "ignore", stderr: "pipe" });
  if (await proc.exited !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Extraction failed: ${stderr.trim()}`);
  }
  unlinkSync(tmpZip);
};

const ensureAssets = async (dataDir: string, version: string) => {
  mkdirSync(dataDir, { recursive: true });
  const assets = checkAssets(dataDir, version);

  const toDownload: Array<{ name: string; url: string }> = [];
  if (!assets.common) toDownload.push({ name: "common", url: `${RELEASE_URL}/common.zip` });
  if (!assets.version) toDownload.push({ name: version, url: `${RELEASE_URL}/${version}.zip` });

  if (toDownload.length === 0) return;

  console.log(`\nMissing assets: ${toDownload.map((d) => d.name).join(", ")}`);
  const download = await confirm({ message: "Download from GitHub releases?", default: true });

  if (!download) {
    const proceed = await confirm({ message: "Continue without assets? (will likely fail)", default: false });
    if (!proceed) process.exit(0);
    return;
  }

  for (const { name, url } of toDownload) {
    await downloadAndExtract(url, dataDir);
    console.log(`  ✓ ${name}`);
  }
  console.log();
};

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

  await ensureAssets(dataDir, version);

  const task = await select({
    message: "Task:",
    choices: [
      { value: "generate", name: "Generate" },
      { value: "debug", name: "Debug" },
    ],
  });

  const isDebug = task === "debug";

  const mode = await select({
    message: "Output mode:",
    choices: [
      { value: RenderMode.Line, name: "Line — individual line images (15 per page)" },
      { value: RenderMode.Page, name: "Page — full page images" },
    ],
  });

  const width = Number(await input({ message: "Width (px):", default: "1440" }));

  let startPage = 1;
  let endPage = 604;
  let randomPages: number[] | undefined;
  let showBounds = false;

  if (isDebug) {
    const pageSelection = await select({
      message: "Pages:",
      choices: [
        { value: "random", name: "Random" },
        { value: "range", name: "Range" },
      ],
    });

    if (pageSelection === "random") {
      const count = Number(await input({ message: "How many pages?", default: "5" })) || 5;
      randomPages = Array.from({ length: count }, () => Math.floor(Math.random() * 604) + 1).sort((a, b) => a - b);
      startPage = randomPages[0]!;
      endPage = randomPages[randomPages.length - 1]!;
      console.log(`  Selected pages: ${randomPages.join(", ")}`);
    } else {
      const pageRange = await input({ message: "Page range (e.g. 1-10):", default: "1-10" });
      const [startStr, endStr] = pageRange.includes("-") ? pageRange.split("-") : [pageRange, pageRange];
      startPage = Number(startStr) || 1;
      endPage = Number(endStr) || startPage;
    }

    showBounds = await confirm({ message: "Overlay glyph bounds?", default: true });
  } else {
    const pageSelection = await select({
      message: "Pages:",
      choices: [
        { value: "all", name: "All (1-604)" },
        { value: "range", name: "Range" },
      ],
    });

    if (pageSelection === "range") {
      const pageRange = await input({ message: "Page range (e.g. 1-10):", default: "1-10" });
      const [startStr, endStr] = pageRange.includes("-") ? pageRange.split("-") : [pageRange, pageRange];
      startPage = Number(startStr) || 1;
      endPage = Number(endStr) || startPage;
    }
  }

  const format = await select({
    message: "Format:",
    choices: [
      { value: ImageFormat.PNG, name: "PNG" },
      { value: ImageFormat.WebP, name: "WebP" },
    ],
  });

  const withMarkers = await confirm({ message: "Include markers?", default: true });
  const quantizeAlpha = !isDebug && format === ImageFormat.PNG && await confirm({ message: "Quantize alpha? (smaller PNGs)", default: false });

  return {
    version,
    mode,
    format,
    startPage,
    endPage,
    width,
    withMarkers,
    showBounds,
    boundsJson: false,
    quantizeAlpha,
    pages: randomPages,
    outputDir: isDebug ? path.join(outputDir, "debug") : outputDir,
    dataDir,
    onProgress: (page) => process.stdout.write(`\r  page ${page}/${endPage}`),
  };
};
