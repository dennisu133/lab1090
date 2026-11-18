import { receiver } from '#lib/server/live-receiver.ts';
import { settings } from '#lib/server/live-settings.ts';
import type { StreamUpdate } from '#lib/receiver-types.ts';
import type { RequestHandler } from './$types';

/**
 * Updates a subscriber may leave unread (4 a second: a minute) before it is dropped. A tab
 * that is frozen, or a link that died without closing, would otherwise queue updates here
 * for as long as the kernel keeps the socket. A tab that wakes up reconnects and goes on
 * from the last update it read, or gets the recent history again if that's too long ago.
 */
const MAX_UNREAD = 240;

/**
 * Server-Sent Events: one long-lived HTTP response, one message per update: `id:` the run
 * and the newest frame so far, `data:` the update as JSON. The browser's EventSource parses
 * this and reconnects by itself if the stream ends, sending the last id it got as
 * Last-Event-ID: the new stream then goes on from there (Receiver.subscribe).
 * The first update also holds the last 10 minutes of positions, for the tracker's trails
 * (see TrackHistory), unless it goes on from an earlier stream, and always the receiver's
 * position: tabs loaded with an older one reload.
 */
export const GET: RequestHandler = ({ request }) => {
	const encoder = new TextEncoder();
	let unsubscribe = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let first = true;
			const send = (update: StreamUpdate, eventId: string) => {
				if (first) {
					update = { ...update, reference: settings.position };
					first = false;
				}
				if ((controller.desiredSize ?? 0) < -MAX_UNREAD) {
					unsubscribe();
					close();
					return;
				}
				try {
					const message = `id: ${eventId}\ndata: ${JSON.stringify(update)}\n\n`;
					controller.enqueue(encoder.encode(message));
				} catch {
					unsubscribe(); // stream already closed
				}
			};
			const close = () => {
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			unsubscribe = receiver().subscribe(send, close, request.headers.get('last-event-id'));
		},
		cancel() {
			unsubscribe(); // the browser went away
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			// nginx buffers responses by default, which holds the updates back.
			'x-accel-buffering': 'no'
		}
	});
};
