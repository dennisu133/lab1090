import type { StreamUpdate } from '#lib/receiver-types.ts';

/**
 * The two links between the antenna and the open page, for the status in the navigation bar:
 * browser ↔ server (the event stream) and server ↔ receiver (the FrameSource, from the
 * stream's updates).
 *
 * The app's one StreamConnection writes here.
 *
 * Module-level state is shared by everyone on a server, but only the browser writes it
 * (StreamConnection.connect runs in an $effect, which never runs during server rendering),
 * so the server always renders the initial "connecting" state.
 */
export const receiverLink = $state<{
	/** Is the browser ↔ server stream open? null until it opens or fails the first time. */
	online: boolean | null;
	/** Server ↔ receiver, from the latest update; null before the first one. */
	status: StreamUpdate['status'] | null;
	/** Where the messages come from, e.g. "RTL-SDR 0" or "pi:30005". */
	source: string | null;
}>({ online: null, status: null, source: null });
