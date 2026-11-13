import type { ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { receiver } from '#lib/server/live-receiver.ts';

/** Connect to the Pi when the server starts, not on the first request. */
export const init: ServerInit = () => {
	if (!building) console.log(`receiver: streaming from ${receiver().source}`);
};
