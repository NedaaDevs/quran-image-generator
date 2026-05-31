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

// Returns a patched copy with palette-0 base ink recolored, or null if the font has no CPAL
// (plain decorative fonts) — those are themed via fillStyle instead.
export const patchCpalBaseInk = (font: Buffer, inkHex: string): Buffer | null => {
	const cpal = findTable(font, TAG_CPAL);
	if (!cpal) return null;

	const hex = inkHex.replace("#", "");
	const inkR = Number.parseInt(hex.slice(0, 2), 16);
	const inkG = Number.parseInt(hex.slice(2, 4), 16);
	const inkB = Number.parseInt(hex.slice(4, 6), 16);

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
		if (alpha > 0 && isNearBlack(red, green, blue)) {
			out[o] = inkB;
			out[o + 1] = inkG;
			out[o + 2] = inkR;
		}
	}
	return out;
};
