import { SvelteSet } from 'svelte/reactivity';
import { notification } from '#lib/describe/alert.ts';
import { SystemNotifications } from '#lib/system-notifications.svelte.ts';
import type { UpdateListener } from '#lib/stream-connection.ts';
import { activeAlerts, alertKey, type Alert } from '#lib/tracker/alerts.ts';
import type { TrackerStream } from './tracker-stream.svelte';

/**
 * The alerts of every aircraft the tracker knows (lib/tracker/alerts.ts), for the whole app:
 * the banner and the tab title show the most important one on every page, and a system
 * notification goes out when one starts (if switched on: SystemNotifications).
 *
 * Fed by the stream right after the tracker, so it runs when a message arrives, also while
 * the tab is in the background. That matters: browsers stop animation frames in a
 * background tab and slow its timers down to once a minute, but not its network events.
 */
export class AlertCenter implements UpdateListener {
	/** The most important first (activeAlerts). */
	alerts = $state.raw<Alert[]>([]);
	readonly notifications = new SystemNotifications();

	#tracker: TrackerStream;
	/** Open an aircraft on the tracker: from a notification's click. */
	#open: (icao: string) => void;
	/** Keys (alertKey) of the alerts active at the last update. */
	// Plain Set on purpose: bookkeeping, never rendered.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#active = new Set<string>();
	/** Alerts whose banner was closed: they don't come back until they're over. */
	#dismissed = new SvelteSet<string>();

	constructor(tracker: TrackerStream, open: (icao: string) => void) {
		this.#tracker = tracker;
		this.#open = open;
	}

	/** The banner's: the most important one not dismissed. */
	get top(): Alert | null {
		return this.alerts.find((x) => !this.#dismissed.has(alertKey(x))) ?? null;
	}

	dismiss(x: Alert): void {
		this.#dismissed.add(alertKey(x));
	}

	receive(): void {
		const alerts = activeAlerts(this.#tracker.aircraft, this.#tracker.now());
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- compared, not rendered
		const keys = new Set(alerts.map(alertKey));
		for (const x of alerts) {
			const key = alertKey(x);
			if (this.#active.has(key)) continue;
			const threat = x.kind === 'advisory' ? this.#tracker.get(x.threat) : null;
			const { title, body } = notification(x, this.#tracker.get(x.icao), threat);
			this.notifications.show(title, body, key, () => this.#open(x.icao));
		}
		for (const key of this.#dismissed) if (!keys.has(key)) this.#dismissed.delete(key);
		this.#active = keys;
		this.alerts = alerts;
	}
}
