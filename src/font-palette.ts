// V4 tajwid fonts store the base (non-tajwid) ink as near-black entries in CPAL palette 0;
// tajwid rules are separate saturated palette colors. Skia/Cairo render palette 0 and ignore
// fillStyle for COLR glyphs, so recoloring those base entries is the only way to lighten the
// base text. Geometry (glyf/hmtx) is untouched, so glyph bounds stay byte-identical.

const TAG_CPAL = 0x4350414c; // "CPAL"
const TAG_COLR = 0x434f4c52; // "COLR"
const TAG_CMAP = 0x636d6170; // "cmap"

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

const toHex = (r: number, g: number, b: number) =>
	`#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;

// Reads palette 0 of the CPAL table as RGB triples (CPAL color records are stored B,G,R,A).
const readPalette0 = (font: Buffer, cpalOffset: number): [number, number, number][] => {
	const numEntries = font.readUInt16BE(cpalOffset + 2);
	const firstColorRecord = font.readUInt32BE(cpalOffset + 8);
	const palette0Start = font.readUInt16BE(cpalOffset + 12); // colorRecordIndices[0]
	const records = cpalOffset + firstColorRecord + palette0Start * 4;
	const palette: [number, number, number][] = [];
	for (let i = 0; i < numEntries; i++) {
		const o = records + i * 4;
		palette.push([font[o + 2] ?? 0, font[o + 1] ?? 0, font[o] ?? 0]);
	}
	return palette;
};

// Maps each glyph id with COLR layers to the distinct saturated (non-near-black) CPAL palette
// indices its layers reference, in layer (paint) order. Near-black base ink is excluded — only
// tajwid rule slots remain. Glyphs with no saturated layer are absent from the map. Indices (not
// hexes) are emitted because the palette slot is a stable rule key, while the RGB value drifts a
// few units across font builds.
const buildColrIndexMap = (font: Buffer, palette: [number, number, number][]): Map<number, number[]> => {
	const colr = findTable(font, TAG_COLR);
	const map = new Map<number, number[]>();
	if (!colr) return map;
	const o = colr.offset;
	// COLR v0 header; v1 keeps these base/layer-record fields at the same offsets.
	const numBase = font.readUInt16BE(o + 2);
	const baseOff = font.readUInt32BE(o + 4);
	const layerOff = font.readUInt32BE(o + 8);
	for (let i = 0; i < numBase; i++) {
		const r = o + baseOff + i * 6;
		const gid = font.readUInt16BE(r);
		const first = font.readUInt16BE(r + 2);
		const num = font.readUInt16BE(r + 4);
		const seen = new Set<number>();
		const indices: number[] = [];
		for (let l = 0; l < num; l++) {
			const lr = o + layerOff + (first + l) * 4;
			const palIdx = font.readUInt16BE(lr + 2);
			if (palIdx === 0xffff) continue; // 0xFFFF = use text foreground, not a palette entry
			const c = palette[palIdx];
			if (!c || isNearBlack(c[0], c[1], c[2])) continue;
			if (!seen.has(palIdx)) {
				seen.add(palIdx);
				indices.push(palIdx);
			}
		}
		if (indices.length > 0) map.set(gid, indices);
	}
	return map;
};

// Parses the font's cmap (formats 4 and 12 — all that QCF Mushaf fonts use) into codepoint→glyphId.
const buildCmap = (font: Buffer): Map<number, number> => {
	const cmap = findTable(font, TAG_CMAP);
	const map = new Map<number, number>();
	if (!cmap) return map;
	const base = cmap.offset;
	const nSub = font.readUInt16BE(base + 2);
	for (let i = 0; i < nSub; i++) {
		const off = base + font.readUInt32BE(base + 4 + i * 8 + 4);
		const format = font.readUInt16BE(off);
		if (format === 4) {
			const segX2 = font.readUInt16BE(off + 6);
			const segCount = segX2 / 2;
			const endO = off + 14;
			const startO = endO + segX2 + 2; // +2 skips reservedPad
			const deltaO = startO + segX2;
			const rangeO = deltaO + segX2;
			for (let s = 0; s < segCount; s++) {
				const end = font.readUInt16BE(endO + s * 2);
				const start = font.readUInt16BE(startO + s * 2);
				const delta = font.readUInt16BE(deltaO + s * 2);
				const rangeOffset = font.readUInt16BE(rangeO + s * 2);
				if (start === 0xffff) continue;
				for (let c = start; c <= end; c++) {
					let g: number;
					if (rangeOffset === 0) g = (c + delta) & 0xffff;
					else {
						const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
						g = font.readUInt16BE(gi);
						if (g !== 0) g = (g + delta) & 0xffff;
					}
					if (g !== 0 && !map.has(c)) map.set(c, g);
				}
			}
		} else if (format === 12) {
			const nGroups = font.readUInt32BE(off + 12);
			for (let gp = 0; gp < nGroups; gp++) {
				const g = off + 16 + gp * 12;
				const startC = font.readUInt32BE(g);
				const endC = font.readUInt32BE(g + 4);
				const startGid = font.readUInt32BE(g + 8);
				for (let c = startC; c <= endC; c++) if (!map.has(c)) map.set(c, startGid + (c - startC));
			}
		}
	}
	return map;
};

// One saturated tajwid palette slot: its CPAL index and canonical hex. Shipped once per bounds.db
// (the palette is identical across all page fonts) so consumers can map index → color if they want
// the font's native swatch; recoloring consumers ignore it and key their own legend on the index.
export interface TajweedPaletteEntry {
	index: number;
	hex: string;
}

export interface TajweedResolver {
	// QCF word string (one or more PUA codepoints) → its distinct tajwid CPAL slot indices, in source
	// order, comma-joined (e.g. "15,5"), or null when the word is base ink only.
	resolve: (textQpc: string) => string | null;
	// The font's saturated (tajwid) palette slots, ascending by index.
	palette: TajweedPaletteEntry[];
}

// Builds a per-font tajwid resolver from its COLR/CPAL/cmap. Indices are read straight from the font
// and are theme-independent (unaffected by any dark-theme recolor). Fonts without COLR/CPAL (V1/V2)
// yield an empty resolver that always returns null and an empty palette.
export const buildTajweedResolver = (font: Buffer): TajweedResolver => {
	const cpal = findTable(font, TAG_CPAL);
	const colr = findTable(font, TAG_COLR);
	if (!cpal || !colr) return { resolve: () => null, palette: [] };
	const palette = readPalette0(font, cpal.offset);
	const paletteEntries: TajweedPaletteEntry[] = [];
	palette.forEach((c, i) => {
		if (!isNearBlack(c[0], c[1], c[2])) paletteEntries.push({ index: i, hex: toHex(c[0], c[1], c[2]) });
	});
	const colrMap = buildColrIndexMap(font, palette);
	const cmap = buildCmap(font);
	const resolve = (textQpc: string) => {
		const seen = new Set<number>();
		const out: number[] = [];
		for (const ch of textQpc) {
			const cp = ch.codePointAt(0);
			if (cp === undefined) continue;
			const gid = cmap.get(cp);
			if (gid === undefined) continue;
			const indices = colrMap.get(gid);
			if (!indices) continue;
			for (const i of indices)
				if (!seen.has(i)) {
					seen.add(i);
					out.push(i);
				}
		}
		return out.length > 0 ? out.join(",") : null;
	};
	return { resolve, palette: paletteEntries };
};
