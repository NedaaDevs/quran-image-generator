import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Some Mushaf TTFs ship with malformed cmap subtables (e.g. v2/p245.ttf has a
// truncated Mac Roman format-6 entry). FreeType — used by Cairo via node-canvas
// — refuses such fonts and falls back to .notdef glyphs (hex-box tofu).
// We rewrite the cmap table in-place, dropping any subtable whose declared
// length is shorter than its format's minimum header.

// Minimum byte length for each cmap subtable format header.
const MIN_HEADER_LEN: Record<number, number> = { 0: 262, 2: 518, 4: 16, 6: 10 };

const findTable = (buf: Buffer, tag: string): { offset: number; length: number } | null => {
	if (buf.length < 12) return null;
	const numTables = buf.readUInt16BE(4);
	for (let i = 0; i < numTables; i++) {
		const rec = 12 + i * 16;
		if (buf.subarray(rec, rec + 4).toString("ascii") === tag) {
			return { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) };
		}
	}
	return null;
};

const sanitizeCmap = (buf: Buffer): Buffer | null => {
	const cmap = findTable(buf, "cmap");
	if (!cmap) return null;
	const { offset: cmapOff, length: cmapLen } = cmap;
	const cmapEnd = cmapOff + cmapLen;
	if (cmapEnd > buf.length) return null;

	const nSub = buf.readUInt16BE(cmapOff + 2);
	type Rec = { pid: number; eid: number; offset: number };
	const records: Rec[] = [];
	for (let i = 0; i < nSub; i++) {
		const r = cmapOff + 4 + i * 8;
		records.push({
			pid: buf.readUInt16BE(r),
			eid: buf.readUInt16BE(r + 2),
			offset: buf.readUInt32BE(r + 4),
		});
	}

	const valid = records.filter((r) => {
		const abs = cmapOff + r.offset;
		if (abs + 4 > cmapEnd) return false;
		const format = buf.readUInt16BE(abs);
		// format >=8 uses uint32 length at offset+4; format <8 uses uint16 length at offset+2
		let length: number;
		if (format >= 8) {
			if (abs + 8 > cmapEnd) return false;
			length = buf.readUInt32BE(abs + 4);
		} else {
			length = buf.readUInt16BE(abs + 2);
		}
		if (abs + length > cmapEnd) return false;
		const min = MIN_HEADER_LEN[format];
		if (min !== undefined && length < min) return false;
		return true;
	});

	if (valid.length === records.length) return null;

	const out = Buffer.from(buf);
	out.writeUInt16BE(valid.length, cmapOff + 2);
	for (const [i, rec] of valid.entries()) {
		const r = cmapOff + 4 + i * 8;
		out.writeUInt16BE(rec.pid, r);
		out.writeUInt16BE(rec.eid, r + 2);
		out.writeUInt32BE(rec.offset, r + 4);
	}
	return out;
};

const tempDir = path.join(os.tmpdir(), "quran-image-gen-fonts");
const cache = new Map<string, string>();

export const sanitizeFontFile = (srcPath: string): string => {
	const cached = cache.get(srcPath);
	if (cached) return cached;

	const buf = readFileSync(srcPath);
	const fixed = sanitizeCmap(buf);
	if (!fixed) {
		cache.set(srcPath, srcPath);
		return srcPath;
	}

	// Content-addressed temp file — survives across runs, no collisions across users
	mkdirSync(tempDir, { recursive: true });
	const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
	const outPath = path.join(tempDir, `${hash}-${path.basename(srcPath)}`);
	if (!existsSync(outPath)) writeFileSync(outPath, fixed);
	console.warn(`Sanitized malformed cmap in ${path.basename(srcPath)}`);
	cache.set(srcPath, outPath);
	return outPath;
};
