import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { generate } from "./generator";
import { promptOptions } from "./interactive";
import { FontVersion, ImageFormat, RenderMode } from "./types";

// Compiled binary uses $bunfs virtual filesystem — resolve paths from the executable location
const isCompiled = import.meta.dir.includes("$bunfs");
const ROOT = isCompiled ? path.dirname(process.execPath) : path.join(import.meta.dir, "..");

// In compiled mode, look for pngquant next to executable, then fall back to system PATH
const resolvePngquant = (): string => {
	if (isCompiled) {
		const local = path.join(ROOT, "pngquant");
		if (existsSync(local)) return local;
		return "pngquant";
	}
	return require("pngquant-bin").default;
};
const pngquantBin = resolvePngquant();

// Embedded at compile time — resolves to $bunfs path in binary, real path in dev
let assetsZip: string | undefined;
try {
	assetsZip = require("../assets.zip");
} catch {}

// Extract embedded assets on first run (compiled binary only)
if (isCompiled && assetsZip && !existsSync(path.join(ROOT, "data", "common"))) {
	const dataDir = path.join(ROOT, "data");
	console.log("Extracting embedded assets...");
	mkdirSync(dataDir, { recursive: true });
	// Copy from $bunfs to temp file — unzip can't read virtual filesystem directly
	const tmpZip = path.join(dataDir, "_assets.zip");
	await Bun.write(tmpZip, Bun.file(assetsZip));
	const proc = Bun.spawn(["unzip", "-o", "-q", tmpZip, "-d", dataDir], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if ((await proc.exited) !== 0) {
		console.error("Failed to extract assets");
		process.exit(1);
	}
	unlinkSync(tmpZip);
	console.log("Done.\n");
}

const hasArgs = process.argv.length > 2;

if (!hasArgs) {
	// Interactive mode
	const opts = await promptOptions(ROOT);

	console.log(
		`\nRendering pages ${opts.startPage}-${opts.endPage} at ${opts.width}px (${opts.version}, ${opts.mode} mode, ${opts.format})...\n`,
	);

	const { count, boundsCount } = await generate({ ...opts, pngquantBin });

	const label = opts.mode === RenderMode.Page ? "pages" : "lines";
	console.log(`\nDone — ${count} ${label} across ${opts.endPage - opts.startPage + 1} pages`);
	if (boundsCount > 0) console.log(`  Bounds: ${boundsCount} glyphs (SQLite)`);
} else {
	// Arg mode
	const version = process.argv.includes("v4")
		? FontVersion.V4
		: process.argv.includes("v2")
			? FontVersion.V2
			: FontVersion.V1;
	const startPage = Number(process.argv[2]) || 1;
	const endPage = Number(process.argv[3]) || startPage;
	const width = Number(process.argv[4]) || 1440;
	const mode = process.argv[5] === "page" ? RenderMode.Page : RenderMode.Line;
	const format = process.argv.includes("webp") ? ImageFormat.WebP : ImageFormat.PNG;
	const withMarkers = !process.argv.includes("no-markers");
	const showBounds = process.argv.includes("bounds");
	const boundsJson = process.argv.includes("json");
	const quantizeAlpha = process.argv.includes("quantize");

	if (startPage < 1 || endPage > 604 || startPage > endPage) {
		console.error(
			"Usage: bun src/cli.ts [startPage] [endPage] [width] [mode] [v1|v2|v4] [no-markers] [webp] [bounds] [json] [quantize]",
		);
		process.exit(1);
	}

	// Check assets in arg mode — error instead of prompt
	const dataDir = path.join(ROOT, "data");
	if (!existsSync(path.join(dataDir, "common", "fonts"))) {
		console.error("Missing data/common/ — download from GitHub releases");
		process.exit(1);
	}
	if (!existsSync(path.join(dataDir, version, "fonts", "p1.ttf"))) {
		console.error(`Missing data/${version}/ — download from GitHub releases`);
		process.exit(1);
	}

	console.log(`Rendering pages ${startPage}-${endPage} at ${width}px (${version}, ${mode} mode, ${format})...\n`);

	const { count, boundsCount } = await generate({
		version,
		mode,
		format,
		startPage,
		endPage,
		width,
		withMarkers,
		centerPages: process.argv.includes("center"),
		showBounds,
		boundsJson,
		quantizeAlpha,
		pngquantBin,
		outputDir: path.join(ROOT, "output"),
		dataDir,
		onProgress: (page) => process.stdout.write(`\r  page ${page}/${endPage}`),
	});

	const label = mode === RenderMode.Page ? "pages" : "lines";
	console.log(`\nDone — ${count} ${label} across ${endPage - startPage + 1} pages`);
	if (boundsCount > 0) console.log(`  Bounds: ${boundsCount} glyphs (SQLite)`);
}
