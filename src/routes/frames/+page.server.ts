import { RECEIVER_POSITION } from '$app/env/private';
import { receiver } from '#lib/server/live-receiver.ts';
import type { PageServerLoad } from './$types';

/**
 * The page decodes positions in the browser, so it needs the receiver's position as the
 * reference point. It's sent to this page only (not baked into the JavaScript bundle).
 * Plus how many frames of each kind the server keeps for filtering (see FrameBuffers).
 */
export const load: PageServerLoad = () => ({
	reference: RECEIVER_POSITION,
	perKind: receiver().buffers.size
});
