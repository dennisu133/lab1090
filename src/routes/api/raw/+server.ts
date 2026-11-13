import { receiver } from '#lib/server/live-receiver.ts';
import type { RawUpdate } from '#lib/receiver-types.ts';
import type { RequestHandler } from './$types';

/**
 * Server-Sent Events: one long-lived HTTP response, one `data: <json>` message per update.
 * The browser's EventSource parses this and reconnects by itself if the stream ends.
 */
export const GET: RequestHandler = () => {
	const encoder = new TextEncoder();
	let unsubscribe = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (update: RawUpdate) => {
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
