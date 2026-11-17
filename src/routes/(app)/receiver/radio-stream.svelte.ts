import type { DemodulatorStats } from '#lib/demod/demodulator.ts';
import type { DemodReport, RadioPoint, SourceEvent, StreamUpdate } from '#lib/receiver-types.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';

/** Rates are averaged over this window, like the navigation bar's. */
const RATE_WINDOW_MS = 10_000;

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

	#samples: { t: number; totals: DemodulatorStats }[] = [];

	receive({ radio }: StreamUpdate): void {
		this.demod = radio.demod;
		if (radio.full) {
			this.points = radio.points;
			this.events = radio.events;
			this.#samples = [];
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
		this.#rate(radio.demod);
	}

	#rate(demod: DemodReport | null): void {
		if (!demod) {
			this.#samples = [];
			this.rates = null;
			return;
		}
		const now = performance.now();
		this.#samples.push({ t: now, totals: demod.totals });
		while (this.#samples.length > 2 && now - this.#samples[0].t > RATE_WINDOW_MS)
			this.#samples.shift();
		const oldest = this.#samples[0];
		const seconds = (now - oldest.t) / 1000;
		if (seconds < 1) return;
		const rates = {} as DemodRates;
		for (const key of Object.keys(demod.totals) as (keyof DemodulatorStats)[]) {
			if (key !== 'level') rates[key] = (demod.totals[key] - oldest.totals[key]) / seconds;
		}
		this.rates = rates;
	}
}
