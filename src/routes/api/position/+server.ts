import { error } from '@sveltejs/kit';
import { parseLatLon } from '#lib/geo.ts';
import { receiver } from '#lib/server/live-receiver.ts';
import { settings } from '#lib/server/live-settings.ts';
import type { RequestHandler } from './$types';

/**
 * Save the antenna position, from /setup: a JSON `{ lat, lon }`. Every open tab's stream
 * ends; they reconnect, see the new position and reload.
 *
 * Not a form action: SvelteKit refuses a form POST whose Origin isn't the URL it thinks it
 * serves, and adapter-bun takes every request for https (it expects TLS to end at a proxy
 * in front), so over plain http on the LAN every save was a 403. Cross-site requests are
 * kept out another way: a PUT with a JSON body is one a page from another site can't send
 * without the browser first asking (CORS preflight), and nothing here answers that.
 */
export const PUT: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
		error(415, 'Send the position as JSON.');
	}
	if (settings.positionFrom === 'flag') {
		error(409, 'The position is set with --position; change it there.');
	}
	let position;
	try {
		const { lat, lon } = await request.json();
		position = parseLatLon(`${lat},${lon}`);
	} catch (e) {
		error(400, (e as Error).message);
	}
	try {
		settings.setPosition(position);
	} catch (e) {
		error(500, `Couldn’t save it: ${(e as Error).message}`);
	}
	receiver().disconnectAll();
	return new Response(null, { status: 204 });
};
