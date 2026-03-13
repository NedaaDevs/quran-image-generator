import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE_URL = "https://static-cdn.tarteel.ai/qul/fonts/quran_fonts";
const FONTS_DIR = path.join(import.meta.dir, "..", "data");

const VERSIONS: Record<string, string> = {
	v1: "v1-optimized",
	v2: "v2",
	v4: "v4",
};

async function downloadVersion(version: string, urlPath: string) {
	const dir = path.join(FONTS_DIR, version, "fonts");
	mkdirSync(dir, { recursive: true });

	console.log(`Downloading ${version} fonts...`);

	let downloaded = 0;
	let skipped = 0;

	// Download in batches of 5 with delay to avoid rate limiting
	for (let start = 1; start <= 604; start += 5) {
		const end = Math.min(start + 4, 604);
		const batch = Array.from({ length: end - start + 1 }, (_, i) => start + i);

		await Promise.all(
			batch.map(async (page) => {
				const file = path.join(dir, `p${page}.ttf`);
				if (existsSync(file)) {
					skipped++;
					return;
				}

				const url = `${BASE_URL}/${urlPath}/ttf/p${page}.ttf?v=3.1`;
				try {
					const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
					if (!res.ok) {
						console.error(`\n  Failed: p${page}.ttf (${res.status})`);
						return;
					}
					await Bun.write(file, res);
					downloaded++;
				} catch {
					console.error(`\n  Timeout: p${page}.ttf — rerun to retry`);
				}
			}),
		);

		process.stdout.write(`\r  ${version}: ${end}/604`);
		await Bun.sleep(200);
	}

	console.log(`\n  Done: ${downloaded} downloaded, ${skipped} skipped`);
}

// Parse args
const arg = process.argv[2] ?? "all";
const versions = arg === "all" ? Object.entries(VERSIONS) : [[arg, VERSIONS[arg]]];

if (!versions.every(([, v]) => v)) {
	console.error("Usage: bun scripts/download-fonts.ts [v1|v2|all]");
	process.exit(1);
}

for (const [version, urlPath] of versions) {
	if (version && urlPath) await downloadVersion(version, urlPath);
}
