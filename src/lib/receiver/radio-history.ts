import { magnitudeDbfs } from '#lib/demod/samples.ts';
import type {
	DemodReport,
	RadioPoint,
	RadioUpdate,
	SourceEvent,
	SourceStatus
} from '#lib/receiver-types.ts';

/** One point per this many ms… */
export const POINT_MS = 10_000;
/** …for an hour. */
export const POINTS = 360;
/** Events kept (starts, failures, the end of a recording). */
const EVENTS = 50;

interface Reading {
	t: number;
	messages: number;
	demod: DemodReport | null;
}

/**
 * The receiver's last hour, for /receiver: every 10 s a point with what happened in those
 * 10 s (messages, noise, clipping, CPU), and the link's events (rtl_sdr started, stopped and
 * why). Kept on the server, so a reload shows the past hour and not an empty chart.
 *
 * Points are made from the running totals (FrameCounts, DemodReport): the difference
 * between two readings. Updates carry everything once (`full`), then only what's new.
 */
export class RadioHistory {
	readonly points: RadioPoint[] = [];
	readonly events: SourceEvent[] = [];
	#previous: Reading;
	#newPoints: RadioPoint[] = [];
	#changed = new Set<SourceEvent>();
	#nextId = 1;

	constructor(now = Date.now()) {
		this.#previous = { t: now, messages: 0, demod: null };
	}

	/**
	 * The totals now: a point if POINT_MS have passed since the last one. `messages`:
	 * FrameCounts' total; `demod`: the decoder's report (null for a Beast feed).
	 */
	read(now: number, messages: number, demod: DemodReport | null): void {
		const before = this.#previous;
		if (now - before.t < POINT_MS) return;
		this.#previous = { t: now, messages, demod };
		const a = before.demod?.totals;
		const b = demod?.totals;
		const diff = (key: 'candidates' | 'clipped' | 'samples' | 'blocks' | 'levelSum') =>
			b ? b[key] - (a?.[key] ?? 0) : null;
		const demodulated = b ? b.accepted + b.repaired - (a ? a.accepted + a.repaired : 0) : null;
		const blocks = diff('blocks');
		const point: RadioPoint = {
			t: now,
			ms: now - before.t,
			messages: messages - before.messages,
			noise: blocks ? magnitudeDbfs((diff('levelSum')! / blocks) * 65535) : null,
			candidates: diff('candidates'),
			demodulated,
			clipped: diff('clipped'),
			busyMs: demod ? demod.busyMs - (before.demod?.busyMs ?? 0) : null,
			samples: diff('samples')
		};
		this.points.push(point);
		if (this.points.length > POINTS) this.points.shift();
		this.#newPoints.push(point);
	}

	/**
	 * The link changed (FrameSource's onStatus). Returns the new event, or null when there is
	 * none: the same state for the same reason as the last one (a retry every 30 s for hours
	 * is one event, counted), or a passing state (connecting, closed). The console log says
	 * the new ones only (Receiver), so both agree on what counts as news.
	 */
	status(status: SourceStatus, now: number): SourceEvent | null {
		if (status.state === 'connecting' || status.state === 'closed') return null;
		const last = this.events.at(-1);
		const reason = 'reason' in status ? status.reason : undefined;
		if (last && last.state === status.state && last.reason === reason) {
			last.count++;
			last.last = now;
			this.#changed.add(last);
			return null;
		}
		const event: SourceEvent = {
			id: this.#nextId++,
			t: now,
			last: now,
			state: status.state,
			count: 1
		};
		if (reason) event.reason = reason;
		this.events.push(event);
		if (this.events.length > EVENTS) this.events.shift();
		this.#changed.add(event);
		return event;
	}

	/** Everything: for a new subscriber. */
	full(demod: DemodReport | null): RadioUpdate {
		return {
			demod,
			full: true,
			points: [...this.points],
			events: this.events.map((e) => ({ ...e }))
		};
	}

	/**
	 * What's new since the last call: for the next batch, to everyone. `demod`: undefined
	 * leaves it out (RadioUpdate.demod).
	 */
	take(demod?: DemodReport | null): RadioUpdate {
		const update: RadioUpdate = {
			...(demod !== undefined && { demod }),
			full: false,
			points: this.#newPoints,
			events: [...this.#changed].map((e) => ({ ...e }))
		};
		this.#newPoints = [];
		this.#changed.clear();
		return update;
	}
}
