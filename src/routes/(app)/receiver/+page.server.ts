import { receiver } from '#lib/server/live-receiver.ts';
import type { PageServerLoad } from './$types';

/**
 * What a new stream starts with, already in the server's page: the radio snapshot
 * (radio-stream.svelte.ts `seed`: which layout the page needs, a demodulator's or a Beast
 * feed's, and its numbers) and the link (source, replay, recording: the Device card's rows).
 * Otherwise the stream's first update would rearrange the page as it arrives.
 */
export const load: PageServerLoad = () => ({
	radio: receiver().radioSnapshot(),
	link: receiver().linkSnapshot()
});
