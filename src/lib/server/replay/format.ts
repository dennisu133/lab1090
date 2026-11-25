import { closeSync, openSync, readSync } from 'node:fs';
import { BeastParser } from '#lib/beast/parser.ts';

/**
 * What a --replay file holds, from its first bytes (not its name: a `.u8` may be called
 * anything):
 *
 *   sigmf-zstd   zstd's magic number, 28 B5 2F FD: a recording from --record
 *   sigmf        "ustar" at byte 257: a tar, a SigMF archive (x.sigmf)
 *   beast        Beast frames: 1A, a type '1'–'4', and the next frames where they belong
 *   samples      anything else: UC8 samples as rtl_sdr writes them (bare, or x.sigmf-data)
 *
 * Samples never look like the others: they hover around 127, and a run that started 1A 33
 * would also have to continue as Beast frames do.
 */
export type FileFormat = 'sigmf-zstd' | 'sigmf' | 'beast' | 'samples';

/** Enough for the tar header and a few Beast frames. */
const HEAD = 4096;

export function detectFormat(head: Uint8Array): FileFormat {
	if (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) {
		return 'sigmf-zstd';
	}
	if (new TextDecoder().decode(head.subarray(257, 262)) === 'ustar') return 'sigmf';
	if (head[0] === 0x1a && head[1] >= 0x31 && head[1] <= 0x34) {
		const parser = new BeastParser();
		parser.push(head);
		if (parser.stats.frames + parser.stats.heartbeats >= 3) return 'beast';
	}
	return 'samples';
}

/** The format of a file (its first HEAD bytes). */
export function fileFormat(path: string): FileFormat {
	const fd = openSync(path, 'r');
	try {
		const head = new Uint8Array(HEAD);
		return detectFormat(head.subarray(0, readSync(fd, head, 0, HEAD, 0)));
	} finally {
		closeSync(fd);
	}
}
