import type { Checked, Verdict } from '#lib/modes/address-filter.ts';

/** How the parity verdicts are shown on /frames, in table order. */
export const VERDICTS: Record<Verdict, { symbol: string; label: string; color: string }> = {
	valid: {
		symbol: '✓',
		label: 'Valid (address in the clear)',
		color: 'text-ok-400'
	},
	known: {
		symbol: '✓',
		label: 'From parity, known aircraft',
		color: 'text-blue-400'
	},
	unknown: {
		symbol: '?',
		label: 'From parity, unknown aircraft',
		color: 'text-warn-400'
	},
	invalid: { symbol: '✗', label: 'Corrupted (CRC mismatch)', color: 'text-error-400' }
};

/** "II 0", "SI 44", … for DF11 replies; null for everything else. */
export function interrogatorLabel(addr: Checked | null): string | null {
	const i = addr?.interrogator;
	if (!i) return null;
	return i.type === 'invalid' ? `IC ${i.code}?` : `${i.type} ${i.code}`;
}

export function addressTitle(addr: Checked): string {
	// The address itself is the cell's text: only say where it came from.
	return addr.source === 'clear'
		? 'Sent in the clear'
		: 'Recovered from the checksum (CRC), which the address is mixed into';
}
