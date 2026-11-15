import type { StreamUpdate } from '#lib/receiver-types.ts';

/**
 * The two links between the antenna and the open page, for the status in the navigation bar:
 * browser ↔ server (the event stream) and server ↔ Pi (the Beast connection, from the
 * stream's updates).
 *
 * Every page opens its own stream (a LiveFeed subclass), and whichever one is open writes
 * here, so the layout can show the status without opening a second stream.
 *
 * Module-level state is shared by everyone on a server, but only the browser writes it
 * (LiveFeed.connect runs in an $effect, which never runs during server rendering), so the
 * server always renders the initial "connecting" state.
 */
export const receiverLink = $state<{
	/** Is the browser ↔ server stream open? null until it opens or fails the first time. */
	online: boolean | null;
	/** Server ↔ Pi, from the latest update; null before the first one. */
	status: StreamUpdate['status'] | null;
	/** Where the server connects to, e.g. "pi:30005". */
	source: string | null;
}>({ online: null, status: null, source: null });
