import type { LatLon } from '#lib/modes/cpr.ts';

/**
 * What the static demo plays (tools/demo.ts writes it, player.ts reads it): a recording
 * made into a seamless loop (fold.ts), in files of `chunkMs` each, Beast messages, gzipped.
 * Their timestamps (12 MHz) count from the loop's start; each file holds the messages from
 * its index × chunkMs on.
 */
export interface DemoManifest {
	version: 1;
	/** The receiver's position the demo shows: moved from the real antenna's, if wanted. */
	reference: LatLon;
	/** When the loop's first moment was recorded, ms since epoch. */
	recordedAt: number;
	/** The loop's length, ms. */
	loopMs: number;
	chunkMs: number;
	/** The files, in order, relative to the manifest. */
	chunks: string[];
}

/** Where the site serves them: the manifest and its files. */
export const DEMO_PATH = '/demo';
export const MANIFEST_FILE = 'manifest.json';
