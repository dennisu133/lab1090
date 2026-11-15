import type { WireFrame } from '#lib/receiver-types.ts';

/**
 * Two lists of frames as one, in arrival order (by id), each frame once. The tracker joins
 * the position history (StreamUpdate.tracks) and the recent frames with it: CPR pairing
 * needs arrival order, and a frame decoded twice would count twice.
 */
export function mergeFrames(a: WireFrame[], b: WireFrame[]): WireFrame[] {
	const byId = new Map<number, WireFrame>();
	for (const f of a) byId.set(f.id, f);
	for (const f of b) byId.set(f.id, f);
	return [...byId.values()].sort((x, y) => x.id - y.id);
}
