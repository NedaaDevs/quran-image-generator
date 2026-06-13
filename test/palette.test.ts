import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type ColorRemap, parseRecolor, patchCpalBaseInk } from "../src/font-palette";
import { DATA_DIR } from "./helpers";

const V4_FONT = path.join(DATA_DIR, "v4", "fonts", "p1.ttf");
const present = existsSync(V4_FONT);

const TAG_CPAL = 0x4350414c;
const TAG_GLYF = 0x676c7966;
const TAG_HMTX = 0x686d7478;
const findTable = (b: Buffer, tag: number) => {
	for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
		const rec = 12 + i * 16;
		if (b.readUInt32BE(rec) === tag) return { offset: b.readUInt32BE(rec + 8), length: b.readUInt32BE(rec + 12) };
	}
	return null;
};
// Palette-0 colors as "rrggbb" strings (records are B,G,R,A).
const palette0 = (b: Buffer): string[] => {
	const cpal = findTable(b, TAG_CPAL)!;
	const base = cpal.offset;
	const n = b.readUInt16BE(base + 2);
	const records = base + b.readUInt32BE(base + 8) + b.readUInt16BE(base + 12) * 4;
	const hex = (v: number) => v.toString(16).padStart(2, "0");
	return Array.from({ length: n }, (_, i) => {
		const o = records + i * 4;
		return hex(b[o + 2]!) + hex(b[o + 1]!) + hex(b[o]!);
	});
};
const tableBytes = (b: Buffer, tag: number) => {
	const t = findTable(b, tag)!;
	return b.subarray(t.offset, t.offset + t.length);
};

describe("parseRecolor", () => {
	test("parses inline SRC=DST spec", () => {
		expect(parseRecolor("F40000=F77B72, 3F48E6=6BA6E6")).toEqual([
			{ from: [0xf4, 0x00, 0x00], to: [0xf7, 0x7b, 0x72] },
			{ from: [0x3f, 0x48, 0xe6], to: [0x6b, 0xa6, 0xe6] },
		]);
	});
	test("parses a JSON-style object map", () => {
		expect(parseRecolor({ F40000: "F77B72" })).toEqual([{ from: [0xf4, 0x00, 0x00], to: [0xf7, 0x7b, 0x72] }]);
	});
	test("rejects malformed pairs", () => {
		expect(() => parseRecolor("F40000")).toThrow(/expected SRC=DST/);
	});
});

describe.skipIf(!present)("patchCpalBaseInk recolor (V4)", () => {
	const font = present ? readFileSync(V4_FONT) : Buffer.alloc(0);

	test("remaps a matching tajwid color, leaves others untouched", () => {
		const before = palette0(font);
		const redIdx = before.indexOf("f40000");
		expect(redIdx).toBeGreaterThanOrEqual(0);

		const map: ColorRemap[] = parseRecolor("F40000=112233");
		const out = patchCpalBaseInk(font, undefined, map)!;
		const after = palette0(out);

		expect(after[redIdx]).toBe("112233");
		// Every other entry is unchanged.
		for (let i = 0; i < before.length; i++) {
			if (i !== redIdx) expect(after[i]).toBe(before[i]!);
		}
	});

	test("matches within ±10/channel tolerance", () => {
		// Font has 09b000; source 08B000 is within tolerance and should match.
		const before = palette0(font);
		const greenIdx = before.indexOf("09b000");
		expect(greenIdx).toBeGreaterThanOrEqual(0);
		const out = patchCpalBaseInk(font, undefined, parseRecolor("08B000=5FC97A"))!;
		expect(palette0(out)[greenIdx]).toBe("5fc97a");
	});

	test("ignores sources outside tolerance", () => {
		// No palette entry is within ±10 of 800000 — palette unchanged.
		const out = patchCpalBaseInk(font, undefined, parseRecolor("800000=FFFFFF"))!;
		expect(palette0(out)).toEqual(palette0(font));
	});

	test("base-ink recolor and tajwid recolor compose", () => {
		const out = patchCpalBaseInk(font, "#E8E0D4", parseRecolor("F40000=F77B72"))!;
		const after = palette0(out);
		// Near-black base entries became the light ink; the red rule became its target.
		expect(after).toContain("e8e0d4");
		expect(after).toContain("f77b72");
	});

	test("keeps glyf/hmtx and buffer length byte-identical", () => {
		const out = patchCpalBaseInk(font, "#E8E0D4", parseRecolor("F40000=F77B72"))!;
		expect(out.length).toBe(font.length);
		expect(tableBytes(out, TAG_GLYF).equals(tableBytes(font, TAG_GLYF))).toBe(true);
		expect(tableBytes(out, TAG_HMTX).equals(tableBytes(font, TAG_HMTX))).toBe(true);
	});

	test("preserves alpha bytes", () => {
		const out = patchCpalBaseInk(font, "#E8E0D4", parseRecolor("F40000=F77B72"))!;
		const cpal = findTable(font, TAG_CPAL)!;
		const records = cpal.offset + font.readUInt32BE(cpal.offset + 8) + font.readUInt16BE(cpal.offset + 12) * 4;
		const n = font.readUInt16BE(cpal.offset + 2);
		for (let i = 0; i < n; i++) expect(out[records + i * 4 + 3]).toBe(font[records + i * 4 + 3]!);
	});

	test("returns null for fonts without CPAL", () => {
		expect(patchCpalBaseInk(Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "#E8E0D4")).toBeNull();
	});
});
