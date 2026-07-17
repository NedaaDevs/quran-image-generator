// Mask tinting primitives: convert a rendered ornament into a white-ink alpha mask and
// pre-tint it per theme (colored styles can't use runtime tint, so slots are baked here).

// Renders/scans authored on transparency: coverage IS the alpha channel.
export const extractAlphaMask = (rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array => {
	const mask = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) mask[i] = rgba[i * 4 + 3] ?? 0;
	return mask;
};

const hexToRgb = (hex: string): [number, number, number] => {
	const v = Number.parseInt(hex.slice(1), 16);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};

// Pre-tint: RGB = theme ink, alpha = coverage.
export const tintMask = (mask: Uint8Array, color: string): Uint8ClampedArray => {
	const [r, g, b] = hexToRgb(color);
	const out = new Uint8ClampedArray(mask.length * 4);
	for (let i = 0; i < mask.length; i++) {
		out[i * 4] = r;
		out[i * 4 + 1] = g;
		out[i * 4 + 2] = b;
		out[i * 4 + 3] = mask[i] as number;
	}
	return out;
};
