/**
 * The first layer of Mode S decoding: what kind of message is this, and from whom?
 * Pure functions on the raw message bytes (7 or 14), shared by server and browser.
 */
import { isDf17Format } from './crc';

/**
 * Downlink Format: the first 5 bits of every Mode S message.
 * DF 24 is special: only its first two bits ("11") are fixed, so DF 24–31 all mean Comm-D.
 */
export function downlinkFormat(data: Uint8Array): number {
	const df = data[0] >> 3;
	return df >= 24 ? 24 : df;
}

/**
 * ADS-B Type Code: the first 5 bits of the 56-bit ME field (byte 4) in DF17/18/19.
 * Decides what the message carries (identification, position, velocity, …).
 * null if the message has no ADS-B payload: DF18 with CF 3/4/7 uses other layouts (see
 * esFormat in squitter.ts), and DF19 only counts if the CRC shows it's laid out like DF17.
 */
export function typeCode(data: Uint8Array): number | null {
	const df = downlinkFormat(data);
	const cf = data[0] & 0b111;
	if (df === 17 || (df === 18 && ![3, 4, 7].includes(cf)) || isDf17Format(data))
		return data[4] >> 3;
	return null;
}

/**
 * The 24-bit ICAO aircraft address, where it's sent in the clear (AA field, bytes 1–3).
 * In the other formats (DF0/4/5/16/20/21) the address is XORed into the parity (AP field)
 * and can only be recovered via the CRC.
 */
export function icaoAddress(data: Uint8Array): string | null {
	const df = downlinkFormat(data);
	if (df !== 11 && df !== 17 && df !== 18) return null;
	return toHex(data.subarray(1, 4)).toUpperCase();
}

/**
 * Read `count` bits starting at bit `first`, counted from 1 like in the specs: bit 1 is the
 * most significant bit of the first byte. So `bits(data, 1, 5)` is the DF, and for an ADS-B
 * payload `bits(me, 1, 5)` is the type code. Up to 53 bits (plain numbers, no BigInt).
 */
export function bits(data: Uint8Array, first: number, count: number): number {
	let n = 0;
	for (let i = first - 1; i < first - 1 + count; i++) {
		n = n * 2 + ((data[i >> 3] >> (7 - (i & 7))) & 1);
	}
	return n;
}

/** The 56-bit payload of a long message (ME in DF17/18, MB in DF20/21, MV in DF16). */
export function payload(data: Uint8Array): Uint8Array | null {
	return data.length === 14 ? data.subarray(4, 11) : null;
}

/**
 * Beast signal byte -> dBFS. readsb sends sqrt(power) * 255, with power relative to full
 * scale (0–1), so power = (s / 255)² and dBFS = 20·log10(s / 255).
 */
export function signalDbfs(signal: number): number {
	return signal === 0 ? -Infinity : 20 * Math.log10(signal / 255);
}

/** readsb counts messages above this as "strong signals" (and auto-gain backs off). */
export const STRONG_SIGNAL_DBFS = -3;

/** Width of the signal histogram buckets, in dB. */
export const SIGNAL_BUCKET_DB = 3;

/**
 * Histogram bucket for a signal level: the lower edge, a multiple of 3 dB, so -3 covers
 * [-3, 0) and lines up with STRONG_SIGNAL_DBFS. The weakest possible byte (1) is -48.1 dBFS,
 * so everything is clamped to -48 and up.
 */
export function signalBucket(dbfs: number): number {
	const bucket = Math.floor(dbfs / SIGNAL_BUCKET_DB) * SIGNAL_BUCKET_DB;
	return Math.min(-SIGNAL_BUCKET_DB, Math.max(-48, bucket));
}

export function toHex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

export function fromHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
	return out;
}

export const DF_NAMES: Record<number, string> = {
	0: 'Short air-air surveillance (ACAS)',
	4: 'Surveillance, altitude reply',
	5: 'Surveillance, identity reply',
	11: 'All-call reply',
	16: 'Long air-air surveillance (ACAS)',
	17: 'Extended squitter (ADS-B)',
	18: 'Extended squitter, non-transponder (TIS-B / ADS-R)',
	19: 'Military extended squitter',
	20: 'Comm-B, altitude reply',
	21: 'Comm-B, identity reply',
	24: 'Comm-D (extended length message)'
};

/**
 * All 32 type codes, grouped by what the message carries. Within a group the layout is the
 * same; the code itself adds a detail (emitter category set, containment radius).
 */
export const TYPE_CODE_GROUPS: readonly { from: number; to: number; name: string }[] = [
	{ from: 0, to: 0, name: 'No position information' },
	{ from: 1, to: 4, name: 'Aircraft identification' },
	{ from: 5, to: 8, name: 'Surface position' },
	{ from: 9, to: 18, name: 'Airborne position (barometric altitude)' },
	{ from: 19, to: 19, name: 'Airborne velocity' },
	{ from: 20, to: 22, name: 'Airborne position (GNSS height)' },
	{ from: 23, to: 23, name: 'Test message' },
	{ from: 24, to: 24, name: 'Surface system status (reserved)' },
	{ from: 25, to: 27, name: 'Reserved' },
	{ from: 28, to: 28, name: 'Aircraft status' },
	{ from: 29, to: 29, name: 'Target state and status' },
	{ from: 30, to: 30, name: 'Aircraft operational coordination (reserved)' },
	{ from: 31, to: 31, name: 'Aircraft operational status' }
];

/** The group a type code (0–31) belongs to. */
export function typeCodeGroup(tc: number) {
	const group = TYPE_CODE_GROUPS.find((g) => tc >= g.from && tc <= g.to);
	if (!group) throw new RangeError(`type code out of range: ${tc}`);
	return group;
}

export function typeCodeName(tc: number): string {
	return typeCodeGroup(tc).name;
}

/**
 * Position messages (airborne TC 9–18 and 20–22, surface TC 5–8) have one layout each. The
 * type code additionally says how much the aircraft vouches for the position: the containment radius Rc,
 * a circle the true position is inside with ~1e-7 risk of being wrong (integrity, not accuracy).
 * Values from DO-260A/B (ADS-B version 1/2). Where two values are given, a supplement bit from
 * the aircraft's operational status message (TC 31) decides.
 */
export function containmentRadius(tc: number): string | null {
	return RC[tc] ?? null;
}

const RC: Record<number, string> = {
	5: '< 7.5 m',
	6: '< 25 m',
	7: '< 75 m or < 185 m',
	8: 'unknown',
	9: '< 7.5 m',
	10: '< 25 m',
	11: '< 75 m or < 185 m',
	12: '< 370 m',
	13: '< 0.5 or 0.6 NM',
	14: '< 1 NM',
	15: '< 2 NM',
	16: '< 4 or 8 NM',
	17: '< 20 NM',
	18: 'unknown',
	20: '< 7.5 m',
	21: '< 25 m',
	22: 'unknown'
};
