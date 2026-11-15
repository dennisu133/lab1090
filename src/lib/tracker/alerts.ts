/**
 * Alerts: what an aircraft says that is worth looking at right now. The rules only; the
 * words are in describe/alert.ts.
 *
 *   Emergency (red):  squawk 7500 / 7600 / 7700; TC 28 emergency states 1, 4, 5, 6
 *                     (general, no communications, unlawful interference, downed aircraft)
 *   Caution (amber):  TC 28 states 2 and 3 (medical, minimum fuel): priority, not distress;
 *                     an ACAS resolution advisory (TC 28 subtype 2, Comm-B 3,0, DF16)
 *
 * Every trigger needs two messages in a row that say so (CONFIRM, the tracker's streaks).
 * Two reasons. Radar replies carry their address only in the checksum, so a corrupted one
 * can pass as a known aircraft's (tracker.ts); and transponders with a knob per digit run
 * through the codes in between while the pilot dials a new one: going from 7000 to 2700
 * passes 7700 for a moment. Pilots are taught to avoid that, but not every one manages.
 * ADS-B sends the emergency state about once a second and the radars ask every few
 * seconds, so the second message is never far behind.
 *
 * Not alerts: the FS/SS "alert" flags in replies and positions (they mean "the squawk
 * changed in the last 18 s" or "it's an emergency code", which the squawk says better), and
 * IDENT (the pilot pressing a button because the controller asked: `identing`, the map
 * blinks the aircraft as the controller's screen does).
 *
 * Shared by the root layout (banner, notifications, tab title) and the tracker page (map,
 * list, panel); pure, no state.
 */
import { inEffect, type ResolutionAdvisory } from '#lib/modes/acas.ts';
import type { TrackedAircraft } from './tracker';

/** Messages in a row needed before anything counts. */
export const CONFIRM = 2;
/** An advisory without a message for this long is over (or out of reach). */
export const ADVISORY_MS = 10_000;
/** IDENT is shown while the last message with SPI is at most this old. */
export const IDENT_MS = 5_000;

export type Tier = 'emergency' | 'caution';

/** What the emergency is about, from the squawk or TC 28's emergency state. */
export type Cause = 'general' | 'radio' | 'hijack' | 'downed' | 'medical' | 'fuel';

interface Common {
	icao: string;
	tier: Tier;
	/** When the first message of it arrived (the server's clock, ms). */
	since: number;
}

export type Alert =
	| (Common & {
			kind: 'emergency';
			cause: Cause;
			/** The squawk, if it's one of the emergency codes (confirmed). */
			squawk: string | null;
			/** TC 28's emergency state, if it's not 0 (confirmed). */
			state: number | null;
	  })
	| (Common & {
			kind: 'advisory';
			advisory: ResolutionAdvisory;
			/** Messages so far. */
			count: number;
			/** The other aircraft, if the advisory names it by address (TTI 1). */
			threat: string | null;
	  });

/** The emergency codes, and what each means. */
export const EMERGENCY_SQUAWKS: Record<string, Cause> = {
	'7500': 'hijack',
	'7600': 'radio',
	'7700': 'general'
};

/** TC 28 emergency states (EMERGENCY_STATES) → cause. 7 is reserved. */
const STATES: Record<number, Cause> = {
	1: 'general',
	2: 'medical',
	3: 'fuel',
	4: 'radio',
	5: 'hijack',
	6: 'downed'
};

const PRIORITY: Cause[] = ['medical', 'fuel'];

/** An aircraft's alerts right now: at most an emergency and an advisory. */
export function alertsOf(a: TrackedAircraft, now: number): Alert[] {
	const alerts: Alert[] = [];

	const squawk =
		a.squawk && a.squawk.count >= CONFIRM && a.squawk.value in EMERGENCY_SQUAWKS ? a.squawk : null;
	const state =
		a.emergency && a.emergency.count >= CONFIRM && a.emergency.value in STATES ? a.emergency : null;
	if (squawk || state) {
		// The state can say more than the squawk (downed aircraft). But an emergency code always
		// means distress: next to 7700, a medical state is the 7700's emergency.
		const fromState = state ? STATES[state.value] : null;
		const fromSquawk = squawk ? EMERGENCY_SQUAWKS[squawk.value] : null;
		const cause =
			fromState && !(fromSquawk && PRIORITY.includes(fromState)) ? fromState : fromSquawk!;
		alerts.push({
			kind: 'emergency',
			icao: a.icao,
			tier: PRIORITY.includes(cause) ? 'caution' : 'emergency',
			since: Math.min(squawk?.since ?? Infinity, state?.since ?? Infinity),
			cause,
			squawk: squawk?.value ?? null,
			state: state?.value ?? null
		});
	}

	const r = a.advisory;
	if (r && r.count >= CONFIRM && inEffect(r.value) && now - r.t <= ADVISORY_MS)
		alerts.push({
			kind: 'advisory',
			icao: a.icao,
			tier: 'caution',
			since: r.since,
			advisory: r.value,
			count: r.count,
			threat: r.value.threat?.type === 'address' ? r.value.threat.icao : null
		});
	return alerts;
}

/** Every alert, the most important first: emergencies, then the newest. */
export function activeAlerts(list: TrackedAircraft[], now: number): Alert[] {
	return list
		.flatMap((a) => alertsOf(a, now))
		.sort((x, y) => (x.tier === y.tier ? y.since - x.since : x.tier === 'emergency' ? -1 : 1));
}

/** The highest tier among an aircraft's alerts; null: none. */
export function tierOf(a: TrackedAircraft, now: number): Tier | null {
	const alerts = alertsOf(a, now);
	if (alerts.some((x) => x.tier === 'emergency')) return 'emergency';
	return alerts.length ? 'caution' : null;
}

/** Is the pilot pressing IDENT (SPI), as far as we can tell right now? */
export function identing(a: TrackedAircraft, now: number): boolean {
	return !!a.ident && a.ident.count >= CONFIRM && now - a.ident.t <= IDENT_MS;
}

/** Identifies an alert across updates: an aircraft has at most one of each kind. */
export const alertKey = (x: Alert) => `${x.icao} ${x.kind}`;
