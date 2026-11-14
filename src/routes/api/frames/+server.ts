import { error, json } from '@sveltejs/kit';
import { fromSearchParams } from '#lib/frame-query.ts';
import { receiver } from '#lib/server/live-receiver.ts';
import type { FramesResponse } from '#lib/receiver-types.ts';
import type { RequestHandler } from './$types';

/**
 * The latest stored frames matching a filter, e.g. /api/frames?tc=23 or ?df=20&verdict=known.
 * Lets /frames find frames that are long gone from the live feed (see FrameBuffers).
 */
export const GET: RequestHandler = ({ url }) => {
	let query;
	try {
		query = fromSearchParams(url.searchParams);
	} catch (e) {
		error(400, (e as Error).message);
	}
	const r = receiver();
	return json({ since: r.since, frames: r.buffers.query(query) } satisfies FramesResponse);
};
