import { expect, test } from 'bun:test';
import { toRgb } from './theme.ts';

// Tailwind 4's oklch values next to its own hex equivalents (tailwindcss v4 colors).
test("oklch → sRGB matches Tailwind's hex values", () => {
	expect(toRgb('oklch(0.141 0.005 285.823)')).toBe('rgba(9, 9, 11, 1)'); // zinc-950 #09090b
	expect(toRgb('oklch(0.705 0.015 286.067)')).toBe('rgba(159, 159, 169, 1)'); // zinc-400 #9f9fa9
	expect(toRgb('oklch(0.985 0 0)', 0.5)).toBe('rgba(250, 250, 250, 0.5)'); // neutral-50 #fafafa
	expect(toRgb('oklch(70.4% 0.14 182.503)')).toBe('rgba(0, 187, 167, 1)'); // teal-500 #00bba7
});

test('outside sRGB, clipped per channel; anything else unchanged', () => {
	expect(toRgb('oklch(0.7 0.4 22)')).toMatch(/^rgba\(255, \d+, \d+, 1\)$/);
	expect(toRgb('#fff')).toBe('#fff');
});
