/**
 * The theme's colours (routes/theme.css) for what no class can colour: the map's lines and
 * labels, canvas drawing. Read from the page's CSS variables, so theme.css stays the one place
 * they're set. Browser only.
 */

/** A colour of theme.css: a role or a colour and its step, as in the classes (`warn-400`). */
export type ThemeColour =
	`${'accent' | 'highlight' | 'ok' | 'warn' | 'error' | 'zinc' | 'blue' | 'green' | 'amber' | 'red'}-${number}`;

/**
 * The colour as `rgba(…)`, with `opacity`. MapLibre takes no `oklch()` (its style
 * validator refuses the layer), so it's converted here.
 */
export function themeColour(name: ThemeColour, opacity = 1): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`);
	if (!value) throw new Error(`theme.css has no --color-${name}`);
	return toRgb(value.trim(), opacity);
}

/**
 * `oklch(L C H)` (L 0–1, as Tailwind writes it) as `rgba(r, g, b, opacity)`, by OKLab and linear
 * sRGB (Björn Ottosson, "A perceptual color space for image processing", 2020). Colours
 * outside sRGB are clipped per channel. Anything else (`#fff`) is returned unchanged.
 */
export function toRgb(css: string, opacity = 1): string {
	const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(css);
	if (!m) return css;
	const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s
	];
	const [r, g, bl] = linear.map((x) => {
		const v = Math.min(1, Math.max(0, x));
		const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
		return Math.round(encoded * 255);
	});
	return `rgba(${r}, ${g}, ${bl}, ${opacity})`;
}
