import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { confirm, input, select } from "@inquirer/prompts";
import { type ColorRemap, parseRecolor } from "./font-palette";
import type { GeneratorOptions } from "./generator";
import type { MarkerScaleName } from "./renderer";
import { FontVersion, ImageFormat, RenderEngine, RenderMode } from "./types";

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
	if ((await proc.exited) !== 0) {
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
			startPage = randomPages[0] ?? 1;
			endPage = randomPages.at(-1) ?? startPage;
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
	const centerPages = await confirm({
		message: "Center pages 1-2? (both axes, like the print)",
		default: false,
	});
	const centerText = await confirm({
		message: "Center ALL text horizontally? (kills justification everywhere; openers already center above)",
		default: false,
	});
	const quantizeAlpha =
		!isDebug &&
		format === ImageFormat.PNG &&
		(await confirm({ message: "Quantize alpha? (smaller PNGs)", default: false }));
	// TODO: re-enable "Color surah names?" prompt once tajweed colors render. The v4-color
	// font stores names as solid-black OT-SVG glyphs (only basmala/emblems carry color),
	// so the option is a no-op until we add an OT-SVG rasterizer (e.g. resvg).
	const colorSurahName = false;

	// Dark theme only applies to V4: its base ink is a CPAL palette entry recolored light,
	// while tajweed colors stay as-is. V1/V2 are monochrome and themed client-side via tintColor.
	const DARK_INK = "#E8E0D4";
	let inkColor: string | undefined;
	if (version === FontVersion.V4 && (await confirm({ message: "Dark theme? (light base ink)", default: false }))) {
		const customInk = await input({ message: "Base ink color:", default: DARK_INK });
		inkColor = customInk.trim() || DARK_INK;
	}
	const theme = inkColor ? "dark" : "light";

	// Optional generic tajweed recolor (V4 only) — no palette is baked in; caller supplies it.
	const parseSpec = (s: string) => parseRecolor(existsSync(s) ? JSON.parse(readFileSync(s, "utf8")) : s);
	let recolor: ColorRemap[] | undefined;
	if (version === FontVersion.V4) {
		const spec = (
			await input({
				message: 'Tajweed recolor? ("SRC=DST,..." or a JSON file, blank for none):',
				default: "",
				validate: (v) => {
					const s = v.trim();
					if (!s) return true;
					try {
						parseSpec(s);
						return true;
					} catch (e) {
						return (e as Error).message;
					}
				},
			})
		).trim();
		if (spec) recolor = parseSpec(spec);
	}

	return {
		version,
		mode,
		format,
		startPage,
		endPage,
		width,
		withMarkers,
		centerPages,
		centerText,
		markerScale: "6x" as MarkerScaleName,
		showBounds,
		boundsJson: false,
		quantizeAlpha,
		colorSurahName,
		inkColor,
		recolor,
		theme,
		bench: false,
		engine: RenderEngine.Cairo,
		pages: randomPages,
		outputDir: isDebug ? path.join(outputDir, "debug") : outputDir,
		dataDir,
		onProgress: (page) => process.stdout.write(`\r  page ${page}/${endPage}`),
	};
};
