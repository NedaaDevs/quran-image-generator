// V4 tajwid fonts store the base (non-tajwid) ink as near-black entries in CPAL palette 0;
// tajwid rules are separate saturated palette colors. Skia/Cairo render palette 0 and ignore
// fillStyle for COLR glyphs, so recoloring those base entries is the only way to lighten the
// base text. Geometry (glyf/hmtx) is untouched, so glyph bounds stay byte-identical.

const TAG_CPAL = 0x4350414c; // "CPAL"

const findTable = (b: Buffer, tag: number): { offset: number; length: number } | null => {
	const numTables = b.readUInt16BE(4);
	for (let i = 0; i < numTables; i++) {
		const rec = 12 + i * 16;
		if (b.readUInt32BE(rec) === tag) return { offset: b.readUInt32BE(rec + 8), length: b.readUInt32BE(rec + 12) };
	}
	return null;
};

// Saturated tajwid colors are left untouched; only (near-)black base entries are recolored.
const isNearBlack = (r: number, g: number, blue: number) => r < 32 && g < 32 && blue < 32;

// A single source→target color substitution applied to matching CPAL entries.
export type ColorRemap = { from: [number, number, number]; to: [number, number, number] };

// ±per-channel tolerance when matching a palette entry to a remap source. Tajwid rule colors
// vary by a few units across font builds, so an exact match would be brittle.
const REMAP_TOLERANCE = 10;
const channelMatch = (a: number, b: number) => Math.abs(a - b) <= REMAP_TOLERANCE;

const parseHex = (hex: string): [number, number, number] => {
	const h = hex.replace("#", "");
	return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
};

// Parse a "RRGGBB=RRGGBB,RRGGBB=RRGGBB" spec (used by the CLI's --recolor flag) into a remap list.
// Also accepts a plain { "RRGGBB": "RRGGBB" } object (e.g. parsed from a --recolor JSON file).
export const parseRecolor = (spec: string | Record<string, string>): ColorRemap[] => {
	const pairs: [string, string][] =
		typeof spec === "string"
			? spec
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
					.map((p) => {
						const [from, to] = p.split("=").map((s) => s.trim());
						if (!from || !to) throw new Error(`Invalid --recolor pair "${p}" (expected SRC=DST)`);
						return [from, to];
					})
			: Object.entries(spec);
	return pairs.map(([from, to]) => ({ from: parseHex(from), to: parseHex(to) }));
};

// Returns a patched copy of the font with palette-0 colors recolored, or null if the font has no
// CPAL (plain decorative fonts) — those are themed via fillStyle instead. Two optional, independent
// transforms: `inkHex` recolors the near-black base ink (dark theme); `recolor` remaps any palette
// entry matching a source color (±tolerance) to its target (e.g. tajwid rules made legible on a
// dark background). Alpha and glyph geometry are never touched.
export const patchCpalBaseInk = (font: Buffer, inkHex?: string, recolor: ColorRemap[] = []): Buffer | null => {
	const cpal = findTable(font, TAG_CPAL);
	if (!cpal) return null;

	const ink = inkHex ? parseHex(inkHex) : null;

	const out = Buffer.from(font); // copy — never mutate the cached source buffer
	const base = cpal.offset;
	const numPaletteEntries = out.readUInt16BE(base + 2);
	const firstColorRecord = out.readUInt32BE(base + 8);
	const palette0Start = out.readUInt16BE(base + 12); // colorRecordIndices[0]
	const records = base + firstColorRecord + palette0Start * 4;

	// Each ColorRecord is 4 bytes in B,G,R,A order.
	for (let i = 0; i < numPaletteEntries; i++) {
		const o = records + i * 4;
		const blue = out[o] ?? 0;
		const green = out[o + 1] ?? 0;
		const red = out[o + 2] ?? 0;
		const alpha = out[o + 3] ?? 0;
		if (alpha === 0) continue; // preserve transparency

		if (ink && isNearBlack(red, green, blue)) {
			out[o] = ink[2];
			out[o + 1] = ink[1];
			out[o + 2] = ink[0];
			continue;
		}
		const hit = recolor.find(
			(c) => channelMatch(red, c.from[0]) && channelMatch(green, c.from[1]) && channelMatch(blue, c.from[2]),
		);
		if (hit) {
			out[o] = hit.to[2];
			out[o + 1] = hit.to[1];
			out[o + 2] = hit.to[0];
		}
	}
	return out;
};
