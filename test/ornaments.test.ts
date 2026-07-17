import { describe, expect, test } from "bun:test";
import { extractAlphaMask, tintMask } from "../src/ornaments";

describe("extractAlphaMask", () => {
	test("mask is the alpha channel", () => {
		const rgba = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 128, 0, 0, 0, 255, 5, 5, 5, 64]);
		expect(Array.from(extractAlphaMask(rgba, 4, 1))).toEqual([0, 128, 255, 64]);
	});
});

describe("tintMask", () => {
	test("pixels take the ink color with mask as alpha", () => {
		const out = tintMask(new Uint8Array([0, 200]), "#B8860B");
		expect(Array.from(out)).toEqual([0xb8, 0x86, 0x0b, 0, 0xb8, 0x86, 0x0b, 200]);
	});
});
