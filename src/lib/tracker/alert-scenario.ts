/**
 * Alerts that never happened: synthetic messages mixed into a recording, so the alert rules
 * (alerts.ts) and the UI can be seen working. The capture has none of them: every reply's
 * FS is 0, every position's SS is 0, its TC 28 messages all say "no emergency", and none of
 * its DF16 replies is an ACAS coordination reply (VDS 0x30).
 *
 * Used by the tests (alerts.test.ts) and by `bun tools/replay.ts --alerts`, which plays the
 * capture with these in it. Never imported by the app.
 *
 * The aircraft are real ones from the capture, so the alerts appear on the map amid real
 * traffic (seconds from the start of the recording):
 *
 *   30–210 s   AUA98F (440822) squawks 7700: TC 28 emergency state 1 once a second, its
 *              replies' ID field 7700 and FS 2 (permanent alert), its positions' SS 1
 *   60–78 s    BEL5XD (44CE75) IDENT: SS 3 in its positions, FS 5 in its replies, 18 s
 *   240–330 s  JSY3M (501C2B) medical: TC 28 emergency state 2 (no emergency code)
 *   300–420 s  DLH4LW (3C65D4) squawks 7600, in its radar replies only (it sends no TC 28)
 *   425–445 s  BEL5XD and THY1333 (4BAAC7), 5 km apart at FL390 and FL380, get an RA
 *              against each other: BEL5XD climb, THY1333 descend (TC 28 subtype 2 once a
 *              second, a DF16 coordination reply every 4 s), then 18 s of "RA terminated"
 *
 * Every rewritten or added message gets a correct checksum: the server checks DF17 CRCs and
 * recovers reply addresses from the parity, as for real ones.
 */
import { checkParity, crc24 } from '#lib/modes/crc.ts';
import { bits, downlinkFormat } from '#lib/modes/frame.ts';
import { squawk } from '#lib/modes/squawk.ts';
import type { BeastFrame } from '#lib/beast/parser.ts';

/** 12 MHz Beast ticks per second. */
const TICKS = 12_000_000;

/** A squawk's four octal digits → the 13-bit ID field (the inverse of squawk.ts). */
export function encodeSquawk(code: string): number {
	const [a, b, c, d] = [...code].map(Number);
	// Bit index 0 is the field's first bit (C1), as in squawk.ts.
	const at = (digit: number, four: number, two: number, one: number) =>
		(((digit >> 2) & 1) << (12 - four)) |
		(((digit >> 1) & 1) << (12 - two)) |
		((digit & 1) << (12 - one));
	return at(a, 5, 3, 1) | at(b, 11, 9, 7) | at(c, 4, 2, 0) | at(d, 12, 10, 8);
}

/** TC 28 subtype 1 (status.ts): emergency (3) | ID (13). */
export function statusMe(emergency: number, code: string): Uint8Array {
	return field([1, 5, 28], [6, 3, 1], [9, 3, emergency], [12, 13, encodeSquawk(code)]);
}

export interface AdvisorySpec {
	/** Climb (up) or descend (down), a positive corrective RA. */
	sense: 'up' | 'down';
	terminated?: boolean;
	/** The other aircraft's address. */
	threat: string;
}

/**
 * A resolution advisory's 56 bits (acas.ts), after an 8-bit prefix: 0xE2 for TC 28 subtype 2
 * (TC 11100, ST 010), 0x30 for DF16's MV and register 3,0.
 */
export function advisoryField(prefix: number, ra: AdvisorySpec): Uint8Array {
	return field(
		[1, 8, prefix],
		[9, 1, 1], // one threat, an RA in effect
		[10, 1, 1], // corrective
		[11, 1, ra.sense === 'down' ? 1 : 0],
		[15, 1, 1], // positive: climb or descend, not a vertical speed limit
		[27, 1, ra.terminated ? 1 : 0],
		[29, 2, 1], // TTI 1: the threat's address follows
		[31, 24, parseInt(ra.threat, 16)]
	);
}

/** A DF17 frame from `icao` with this ME, and its CRC. */
export function df17(icao: string, me: Uint8Array): Uint8Array {
	const data = new Uint8Array(14);
	data[0] = (17 << 3) | 5; // CA 5: level 2+ transponder, airborne
	data.set(hex24(icao), 1);
	data.set(me, 4);
	return withCrc(data);
}

/** DF17: the CRC into the last 3 bytes. */
export function withCrc(data: Uint8Array): Uint8Array {
	const crc = crc24(data, data.length - 3);
	data.set([crc >> 16, (crc >> 8) & 0xff, crc & 0xff], data.length - 3);
	return data;
}

/** Replies: address and parity overlaid (AP), as the transponder sends them. */
function withAp(data: Uint8Array, icao: string): Uint8Array {
	const ap = crc24(data, data.length - 3) ^ parseInt(icao, 16);
	data.set([ap >> 16, (ap >> 8) & 0xff, ap & 0xff], data.length - 3);
	return data;
}

const hex24 = (icao: string) => {
	const v = parseInt(icao, 16);
	return [v >> 16, (v >> 8) & 0xff, v & 0xff];
};

/** A 56-bit field from [first bit (1 = MSB), bit count, value] triples. */
function field(...parts: [number, number, number][]): Uint8Array {
	const data = new Uint8Array(7);
	for (const [first, count, value] of parts) put(data, first, count, value);
	return data;
}

/** Set `count` bits from `first` (1 = MSB) in a message. */
export function put(data: Uint8Array, first: number, count: number, value: number): void {
	for (let i = 0; i < count; i++) {
		const bit = first - 1 + i;
		const mask = 0x80 >> (bit & 7);
		if ((value >> (count - 1 - i)) & 1) data[bit >> 3] |= mask;
		else data[bit >> 3] &= ~mask;
	}
}

/**
 * A DF16 ACAS coordination reply with this MV, its altitude field (bits 20–32) copied from
 * one of the aircraft's own replies. VS 0 (airborne), SL 7 (ACAS's highest sensitivity
 * level, above FL200 or so), RI 3 (ACAS with vertical resolution capability).
 */
function df16(icao: string, mv: Uint8Array, ac13: number): Uint8Array {
	const data = new Uint8Array(14);
	put(data, 1, 5, 16);
	put(data, 9, 3, 7);
	put(data, 14, 4, 3);
	put(data, 20, 13, ac13);
	data.set(mv, 4);
	return withAp(data, icao);
}

const AUA98F = '440822';
const BEL5XD = '44CE75';
const JSY3M = '501C2B';
const DLH4LW = '3C65D4';
const THY1333 = '4BAAC7';

/** What happens to an aircraft's own messages, and when (seconds). */
interface Rewrite {
	icao: string;
	from: number;
	to: number;
	/** Replies' ID field (DF5/21). */
	squawk?: string;
	/** Replies' FS field (DF4/5/20/21). */
	fs?: number;
	/** Positions' SS field (TC 9–18). */
	ss?: number;
	/** TC 28 subtype 1's emergency state. */
	emergency?: number;
}

const REWRITES: Rewrite[] = [
	{ icao: AUA98F, from: 30, to: 210, squawk: '7700', fs: 2, ss: 1, emergency: 1 },
	{ icao: BEL5XD, from: 60, to: 78, fs: 5, ss: 3 },
	{ icao: JSY3M, from: 240, to: 330, emergency: 2 },
	{ icao: DLH4LW, from: 300, to: 420, squawk: '7600', fs: 2, ss: 1 }
];

/** The recording with the scenario in it, in time order. */
export function injectAlerts(frames: BeastFrame[]): BeastFrame[] {
	const t0 = frames[0].timestamp;
	const seconds = (f: BeastFrame) => (f.timestamp - t0) / TICKS;
	/** Each aircraft's last squawk, signal and altitude code, for the messages added. */
	const squawks = new Map<string, string>();
	const signals = new Map<string, number>();
	const altitudes = new Map<string, number>();

	const out: BeastFrame[] = frames.map((f) => {
		if (f.kind === 'modeac') return f;
		const icao = addressOf(f.data);
		if (!icao) return f;
		signals.set(icao, f.signal);
		const df = downlinkFormat(f.data);
		if (df === 4 || df === 20) altitudes.set(icao, bits(f.data, 20, 13));
		if (df === 17 && bits(f.data, 33, 8) === 0xe1) squawks.set(icao, squawk(bits(f.data, 44, 13)));
		const s = seconds(f);
		const r = REWRITES.find((r) => r.icao === icao && s >= r.from && s < r.to);
		if (!r) return f;
		const data = f.data.slice();
		if (df === 17) {
			const tc = bits(data, 33, 5);
			if (r.ss !== undefined && tc >= 9 && tc <= 18) put(data, 38, 2, r.ss);
			else if (r.emergency !== undefined && tc === 28 && bits(data, 38, 3) === 1) {
				put(data, 41, 3, r.emergency);
				if (r.squawk) put(data, 44, 13, encodeSquawk(r.squawk));
			} else return f;
			return { ...f, data: withCrc(data) };
		}
		if (![4, 5, 20, 21].includes(df)) return f;
		if (r.fs !== undefined) put(data, 6, 3, r.fs);
		if (r.squawk && (df === 5 || df === 21)) put(data, 20, 13, encodeSquawk(r.squawk));
		return { ...f, data: withAp(data, icao) };
	});

	const added: BeastFrame[] = [];
	const at = (s: number, data: Uint8Array, icao: string) =>
		added.push({
			kind: 'long',
			timestamp: t0 + Math.round(s * TICKS),
			signal: signals.get(icao) ?? 100,
			data
		});
	// TC 28 subtype 1 goes out once a second during an emergency (DO-260B: faster than its usual
	// rate while an emergency is set; once a second is a round figure).
	for (let s = 30; s < 210; s++) at(s + 0.3, df17(AUA98F, statusMe(1, '7700')), AUA98F);
	for (let s = 240; s < 330; s++)
		at(s + 0.3, df17(JSY3M, statusMe(2, squawks.get(JSY3M) ?? '1000')), JSY3M);
	// The RA, and the 18 s after it with RAT set.
	const pair = [
		{ icao: BEL5XD, ra: { sense: 'up', threat: THY1333 } },
		{ icao: THY1333, ra: { sense: 'down', threat: BEL5XD } }
	] as const;
	for (const { icao, ra } of pair) {
		for (let s = 425; s < 463; s++) {
			const terminated = s >= 445;
			at(s + 0.6, df17(icao, advisoryField(0xe2, { ...ra, terminated })), icao);
			if (!terminated && s % 4 === 1)
				at(s + 0.1, df16(icao, advisoryField(0x30, ra), altitudes.get(icao) ?? 0), icao);
		}
	}
	return [...out, ...added].sort((a, b) => a.timestamp - b.timestamp);
}

/** The sender of a Mode S frame: in the clear, or recovered from the parity. */
function addressOf(data: Uint8Array): string | null {
	return checkParity(data)?.icao ?? null;
}
