import type { SourceStatus } from '#lib/receiver-types.ts';

/**
 * What every FrameSource (frame-source.ts) does the same way: keep a status and report each
 * change, and when the link fails, try again later with exponential backoff (1 s, 2 s, 4 s …
 * up to 30 s), until closed. Backoff, so that a receiver that's gone for hours (a Pi switched
 * off, a dongle unplugged) costs one attempt every 30 s, not a busy loop, while a short
 * hiccup is over in a second. The wait starts short again after a success (`connected`).
 *
 * How to connect, and what counts as a failure, is the subclass's: TcpClient (a Beast feed,
 * rtl_tcp), RtlSdr (the rtl_sdr program), Recording (a file: no retries).
 */

export interface SourceOptions {
	onStatus?: (status: SourceStatus) => void;
	minBackoffMs?: number;
	maxBackoffMs?: number;
}

export abstract class SourceBase {
	status: SourceStatus = { state: 'closed' };
	/** close() was called: stop for good, whatever is still under way. */
	protected closed = false;

	#onStatus: (status: SourceStatus) => void;
	#minBackoffMs: number;
	#maxBackoffMs: number;
	/** Consecutive failed attempts; drives the backoff. */
	#failures = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;

	constructor({ onStatus = () => {}, minBackoffMs = 1_000, maxBackoffMs = 30_000 }: SourceOptions) {
		this.#onStatus = onStatus;
		this.#minBackoffMs = minBackoffMs;
		this.#maxBackoffMs = maxBackoffMs;
	}

	abstract start(): this;

	/** Stop for good: cancel any pending retry. Subclasses also end their link. */
	close(): void {
		this.closed = true;
		clearTimeout(this.#retryTimer);
		this.setStatus({ state: 'closed' });
	}

	protected setStatus(status: SourceStatus): void {
		this.status = status;
		this.#onStatus(status);
	}

	/** The link is up: the next failure waits the shortest time again. */
	protected connected(): void {
		this.#failures = 0;
		this.setStatus({ state: 'connected' });
	}

	/** The link failed for `reason`: say so, and call `again` after the backoff. */
	protected retry(reason: string, again: () => void): void {
		if (this.closed) return;
		const retryInMs = Math.min(this.#maxBackoffMs, this.#minBackoffMs * 2 ** this.#failures);
		this.#failures++;
		this.setStatus({ state: 'waiting', retryInMs, retryAt: Date.now() + retryInMs, reason });
		this.#retryTimer = setTimeout(again, retryInMs);
	}
}
