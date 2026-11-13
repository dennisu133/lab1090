/**
 * Print every Mode S message in a Beast capture as hex, one per line, deduplicated
 * (aircraft repeat themselves a lot). Input for the pyModeS oracle:
 *
 *   bun tools/dump-messages.ts fixtures/capture.beast | tools/.venv/bin/python tools/oracle.py
 */
import { BeastParser } from '../src/lib/server/beast/parser.ts';
import { toHex } from '../src/lib/modes/frame.ts';

const path = process.argv[2] ?? 'fixtures/capture.beast';
const frames = new BeastParser().push(new Uint8Array(await Bun.file(path).arrayBuffer()));
const seen = new Set<string>();
for (const f of frames) {
	if (f.kind === 'modeac') continue;
	const hex = toHex(f.data);
	if (!seen.has(hex)) {
		seen.add(hex);
		console.log(hex);
	}
}
