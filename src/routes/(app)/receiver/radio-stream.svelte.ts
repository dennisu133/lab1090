import type { DemodulatorStats } from '#lib/demod/demodulator.ts';
import type { DemodReport, RadioPoint, SourceEvent, StreamUpdate } from '#lib/receiver-types.ts';
import { perSecond, RateWindow } from '#lib/rate-window.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';

export type DemodRates = Record<Exclude<keyof DemodulatorStats, 'level'>, number>;

/**
 * The receiver's own numbers for /receiver: the demodulator's report (totals, device, sample
 * clock), the server's last hour in 10-second points and the link's events. All kept on the
 * server (RadioHistory), so a reload shows the past hour too; this only merges the updates.
 * Plus per-second rates of the demodulator's totals over the last 10 s, for the stages.
 */
export class RadioStream implements UpdateListener {
	/** null: a Beast feed, or nothing heard from the server yet. */
	demod = $state.raw<DemodReport | null>(null);
	points = $state.raw<RadioPoint[]>([]);
	events = $state.raw<SourceEvent[]>([]);
	/** Per second over the last 10 s; null until there's a window to measure. */
	rates = $state.raw<DemodRates | null>(null);

	/** Over the last 10 s, like the navigation bar's. */
	#window = new RateWindow<DemodulatorStats>();

	receive({ radio }: StreamUpdate): void {
		// Absent: unchanged (the server sends it once a second).
		if (radio.demod !== undefined) this.demod = radio.demod;
		if (radio.full) {
			this.points = radio.points;
			this.events = radio.events;
			this.#window.clear();
			this.rates = null;
		} else {
			// An hour, like the server keeps (RadioHistory POINTS).
			if (radio.points.length) this.points = [...this.points, ...radio.points].slice(-360);
			if (radio.events.length) {
				// A handful of events (≤ 50): changed ones replace theirs, new ones go at the end.
				const changed = radio.events;
				const kept = this.events.map((e) => changed.find((c) => c.id === e.id) ?? e);
				const added = changed.filter((c) => !this.events.some((e) => e.id === c.id));
				this.events = [...kept, ...added];
			}
		}
		if (radio.demod !== undefined) this.#rate(radio.demod);
	}

	#rate(demod: DemodReport | null): void {
		if (!demod) {
			this.#window.clear();
			this.rates = null;
			return;
		}
		const window = this.#window.add(performance.now(), demod.totals);
		if (!window) return;
		const rates: Partial<DemodulatorStats> = perSecond(demod.totals, window.then, window.seconds);
		delete rates.level; // a sum of noise levels, not a count: no rate
		this.rates = rates as DemodRates;
	}
}
