import { receiver } from '#lib/server/live-receiver.ts';
import type { PageServerLoad } from './$types';

/**
 * How many frames of each kind the server keeps for filtering (see FrameBuffers). The
 * receiver's position, the reference for local CPR decoding, comes from the root layout.
 */
export const load: PageServerLoad = () => ({ perKind: receiver().buffers.size });
