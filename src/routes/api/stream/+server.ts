import { receiver } from '#lib/server/live-receiver.ts';
import type { StreamUpdate } from '#lib/receiver-types.ts';
import type { RequestHandler } from './$types';

/**
 * Server-Sent Events: one long-lived HTTP response, one `data: <json>` message per update.
 * The browser's EventSource parses this and reconnects by itself if the stream ends.
 * The first update also holds the last 10 minutes of positions, for the tracker's trails
 * (see TrackHistory).
 */
export const GET: RequestHandler = () => {
	const encoder = new TextEncoder();
	let unsubscribe = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (update: StreamUpdate) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
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
			unsubscribe = receiver().subscribe(send, close);
		},
		cancel() {
			unsubscribe(); // the browser went away
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache'
		}
	});
};
