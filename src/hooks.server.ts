import type { ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { receiver } from '#lib/server/live-receiver.ts';

/** Connect to the Pi when the server starts, not on the first request. */
export const init: ServerInit = () => {
	if (building) return;
	console.log(`receiver: streaming from ${receiver().source}`);

	// Production (`bun ./build`): on SIGTERM/SIGINT the adapter stops accepting requests and
	// waits for open ones to finish, then exits once nothing keeps the event loop busy. But
	// the event streams to open tabs never finish on their own, and the connection to the Pi
	// and the batch timer keep the loop busy forever. So stop the receiver right away: that
	// closes every stream (the wait ends at once) and the connection, and the process exits.
	// Not in dev: Vite has its own Ctrl+C handling, and a listener here would override the
	// default exit.
	if (!dev) {
		for (const signal of ['SIGTERM', 'SIGINT'] as const) {
			process.once(signal, () => receiver().stop());
		}
	}
};
