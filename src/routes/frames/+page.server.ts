import { REFERENCE_POINT } from '$app/env/private';
import { receiver } from '#lib/server/live-receiver.ts';
import type { PageServerLoad } from './$types';

/**
 * The page decodes positions in the browser, so it needs the reference point. It's sent
 * to this page only (not baked into the JavaScript bundle). It's rounded anyway (see README).
 * Plus how many frames of each kind the server keeps for filtering (see FrameBuffers).
 */
export const load: PageServerLoad = () => ({
	reference: REFERENCE_POINT,
	perKind: receiver().buffers.size
});
