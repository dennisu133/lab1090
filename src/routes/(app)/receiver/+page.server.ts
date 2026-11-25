import { error } from '@sveltejs/kit';
import { DEMO } from '#lib/demo/mode.ts';
import { receiver } from '#lib/server/live-receiver.ts';
import type { PageServerLoad } from './$types';

/** Never a static page; the demo has no receiver, so no such page either. */
export const prerender = false;

/**
 * What a new stream starts with, already in the server's page: the radio snapshot
 * (radio-stream.svelte.ts `seed`: which layout the page needs, a demodulator's or a Beast
 * feed's, and its numbers) and the link (source, replay, recording: the Device card's rows).
 * Otherwise the stream's first update would rearrange the page as it arrives.
 */
export const load: PageServerLoad = () => {
	if (DEMO) error(404, 'Not found');
	return { radio: receiver().radioSnapshot(), link: receiver().linkSnapshot() };
};
