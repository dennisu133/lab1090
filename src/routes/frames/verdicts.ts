import type { Checked, Verdict } from '#lib/modes/address-filter.ts';

/** How the parity verdicts are shown on /frames, in table order. */
export const VERDICTS: Record<Verdict, { symbol: string; label: string; color: string }> = {
	valid: {
		symbol: '✓',
		label: 'Valid (address in the clear)',
		color: 'text-emerald-400'
	},
	known: {
		symbol: '✓',
		label: 'From parity, known aircraft',
		color: 'text-sky-400'
	},
	unknown: {
		symbol: '?',
		label: 'From parity, unknown aircraft',
		color: 'text-amber-400'
	},
	invalid: { symbol: '✗', label: 'Corrupted (CRC mismatch)', color: 'text-rose-400' }
};

/** "II 0", "SI 44", … for DF11 replies; null for everything else. */
export function interrogatorLabel(addr: Checked | null): string | null {
	const i = addr?.interrogator;
	if (!i) return null;
	return i.type === 'invalid' ? `IC ${i.code}?` : `${i.type} ${i.code}`;
}

export function addressTitle(addr: Checked): string {
	const how =
		addr.source === 'clear' ? 'sent in the clear' : 'recovered from the parity (CRC XOR address)';
	return `${addr.icao}, ${how}`;
}
