/**
 * Test helpers: pyModeS's decode of every distinct message in the capture (the "oracle",
 * see tools/README.md), and the capture's messages. Only imported by tests.
 */
import { join } from 'node:path';
import { BeastParser } from '#lib/server/beast/parser.ts';
import { nl, type LatLon } from './cpr';
import { fromHex } from './frame';
import type { Cpr } from './position';

const root = join(import.meta.dir, '../../..');

/** One line of fixtures/oracle/decoded.jsonl: field names as pyModeS returns them. */
export type OracleEntry = { message: string; df: number; data: Uint8Array } & Record<
	string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	any
>;

export const oracle: OracleEntry[] = (
	await Bun.file(join(root, 'fixtures/oracle/decoded.jsonl')).text()
)
	.trim()
	.split('\n')
	.map((line) => {
		const entry = JSON.parse(line);
		return { ...entry, data: fromHex(entry.message) };
	});

/** pyModeS's answer for each of the 8,192 possible 13-bit altitude and identity codes. */
export const codes: { altitude: (number | null)[]; squawk: string[] } = await Bun.file(
	join(root, 'fixtures/oracle/codes.json')
).json();

/** Every Mode S message of the capture, in order, duplicates included. */
export const messages: Uint8Array[] = new BeastParser()
	.push(new Uint8Array(await Bun.file(join(root, 'fixtures/capture.beast')).arrayBuffer()))
	.filter((f) => f.kind !== 'modeac')
	.map((f) => f.data);

/** mulberry32: small seeded PRNG, so "random" tests are the same every run. */
export function prng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** pyModeS's CPR decoding of every airborne position in the capture (tools/oracle-cpr.py). */
export const cprOracle: {
	nl_boundaries: number[];
	reference: [number, number];
	positions: {
		t: number;
		message: string;
		icao: string;
		global: [number, number] | null;
		local: [number, number];
	}[];
} = await Bun.file(join(root, 'fixtures/oracle/cpr.json')).json();

/** Every Mode S message of the capture with its receiver time in ms, in order. */
export const timedMessages: { t: number; data: Uint8Array }[] = new BeastParser()
	.push(new Uint8Array(await Bun.file(join(root, 'fixtures/capture.beast')).arrayBuffer()))
	.filter((f) => f.kind !== 'modeac')
	.map((f) => ({ t: f.timestamp / 12_000, data: f.data }));

/**
 * pyModeS on every Comm-B payload of the capture, plus a bit-flipped copy of each
 * (tools/oracle-commb.py): which of its registers accept it, and their decoded fields.
 */
export const commbOracle: {
	mb: string;
	real: boolean;
	inferred: string[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	valid: Record<string, Record<string, any>>;
}[] = (await Bun.file(join(root, 'fixtures/oracle/commb.jsonl')).text())
	.trim()
	.split('\n')
	.map((line) => JSON.parse(line));

/**
 * pyModeS on synthetic messages (tools/oracle-synthetic.py): every type code and subtype,
 * every operational status version, DF18 with each CF, DF19, DF16 coordination replies.
 * Random payloads with a correct CRC: well-formed, not necessarily sensible.
 */
export const syntheticOracle: OracleEntry[] = (
	await Bun.file(join(root, 'fixtures/oracle/synthetic.jsonl')).text()
)
	.trim()
	.split('\n')
	.map((line) => {
		const entry = JSON.parse(line);
		return { ...entry, data: fromHex(entry.message) };
	});

type Pair = [number, number];

/** Surface positions near a reference, encoded by our encoder, decoded by pyModeS. */
export const surfaceOracle: {
	reference: Pair;
	truth: Pair;
	even: Pair;
	odd: Pair;
	local_even: Pair;
	local_odd: Pair;
	pair_even_newer: Pair | null;
	pair_odd_newer: Pair | null;
}[] = await Bun.file(join(root, 'fixtures/oracle/surface.json')).json();

/**
 * The encoder, as the aircraft runs it (DO-260B A.1.7.1): the inverse of decoding, for
 * testing with positions anywhere in the world. Rounds to the nearest 1/2^17 of a zone.
 * `span` 90: surface positions (A.1.7.3), zones a quarter the size, like
 * tools/oracle-synthetic.py's encode_surface.
 */
export function encodeCpr({ lat, lon }: LatLon, format: Cpr['format'], span: 360 | 90 = 360): Cpr {
	const i = format === 'odd' ? 1 : 0;
	const mod = (a: number, b: number) => a - b * Math.floor(a / b);
	const dLat = span / (60 - i);
	const yz = Math.floor((131072 * mod(lat, dLat)) / dLat + 0.5);
	const rlat = dLat * (yz / 131072 + Math.floor(lat / dLat));
	const dLon = span / Math.max(nl(rlat) - i, 1);
	const xz = Math.floor((131072 * mod(lon, dLon)) / dLon + 0.5);
	return { format, lat: mod(yz, 131072), lon: mod(xz, 131072) };
}
