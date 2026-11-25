import { onMount } from 'svelte';
import { page } from '$app/state';
import { DEMO } from '#lib/demo/mode.ts';

/**
 * What a page opens with from its ?query (`/frames?df=17`, the tracker's links), as a
 * component's starting state: read when the server renders the page.
 *
 * The demo's pages are made at build time, one per page whatever the query (DEMO): there it
 * starts without one, as built, and the query comes once the page runs (`apply`). Reading
 * it straight away would make the first render differ from the built page.
 */
export function startingQuery<T>(
	read: (params: { get(name: string): string | null }) => T,
	apply: (value: T) => void
): T {
	if (!DEMO) return read(page.url.searchParams);
	onMount(() => apply(read(page.url.searchParams)));
	return read(new URLSearchParams());
}
