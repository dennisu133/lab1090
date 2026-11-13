/**
 * Test helpers: pyModeS's decode of every distinct message in the capture (the "oracle",
 * see tools/README.md), and the capture's messages. Only imported by tests.
 */
import { join } from 'node:path';
import { BeastParser } from '#lib/server/beast/parser.ts';
import { fromHex } from './frame';

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
