/** Number formats shared by /receiver's cards (the general ones are in describe/format.ts). */

/** A share as a percentage: 0.4 %, 12 %, < 0.1 %. */
export function percent(share: number): string {
	if (share > 0 && share < 0.001) return '< 0.1 %';
	return `${share < 0.1 ? (share * 100).toFixed(1) : Math.round(share * 100)} %`;
}

/** 45 s, 12 min, 3 h 05 min. */
export function duration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)} s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export type Tone = 'good' | 'warn' | 'bad' | 'none';

export const TONE_DOT: Record<Tone, string> = {
	good: 'bg-ok-400',
	warn: 'bg-warn-400',
	bad: 'bg-error-400',
	none: 'bg-zinc-600'
};
