/**
 * Pairs each aircraft's 5,0 and 6,0 replies into observations (observation.ts), and keeps
 * what /weather shows per aircraft: the latest observation, the latest trusted wind and
 * temperature, and their average over the last minute.
 *
 * Every new 5,0 is paired with the aircraft's latest 6,0 and vice versa, so one reply can
 * take part in several observations. Feed it only replies whose address is verified and
 * whose register is certain (pipeline.ts decides which to trust): a 6,0 put under the wrong aircraft,
 * or a 5,0 mistaken for a 6,0, would make up a wind.
 *
 * Immutable snapshots, like /comm-b's aircraft list: every change makes a new object, so
 * the page re-renders only the rows that changed.
 */
import type { HeadingAndSpeed, TrackAndTurn } from '#lib/modes/registers.ts';
import { observe, type Inputs, type Observation, type Reading } from './observation';
import { meanWind, type Vector, type Wind } from './wind';

/** Aircraft without a 5,0 or 6,0 for this long are dropped. */
export const AIRCRAFT_TTL_MS = 60_000;
/** Averages cover this long. */
export const AVERAGE_MS = 60_000;
/** A partner older than this isn't paired with at all (no observation, not even a rejected one). */
const PARTNER_MAX_AGE_MS = 30_000;

export interface Average {
	wind: Wind | null;
	/**
	 * The mean air vector (TAS along the true heading) behind `wind`, kt. A heading
	 * correction (headings.ts) turns it, and since turning is linear, the corrected mean
	 * wind is mean ground − turned mean air: wind + air − turn(air).
	 */
	air: Vector | null;
	windCount: number;
	kelvin: number | null;
	temperatureCount: number;
	/**
	 * Mean deviation from the standard atmosphere, K. More telling than the mean
	 * temperature for an aircraft that climbs or descends: in a minute at 2,000 ft/min the
	 * temperature falls by 4 °C just from the height, the deviation hardly changes.
	 */
	isaDeviation: number | null;
	isaCount: number;
}

export interface WeatherAircraft {
	icao: string;
	callsign: string | null;
	lastRx: number;
	/** The latest pair, trusted or not. */
	latest: Observation;
	/** The latest observation with a trusted wind / temperature. */
	lastWind: Observation | null;
	lastTemperature: Observation | null;
	/** Trusted observations of the last minute. */
	average: Average;
	/** Observations since the aircraft appeared, and how many had a trusted wind. */
	observations: number;
	trustedWinds: number;
}

interface State {
	trackAndTurn: Reading<TrackAndTurn> | null;
	headingAndSpeed: Reading<HeadingAndSpeed> | null;
	/** Trusted values of the last AVERAGE_MS. */
	winds: { rx: number; wind: Wind; air: Vector }[];
	kelvins: { rx: number; kelvin: number; isaDeviation: number | null }[];
	snapshot: WeatherAircraft | null;
}

export interface Context {
	altitude: Inputs['altitude'];
	position: Inputs['position'];
	callsign: string | null;
}

export class WeatherTracker {
	// Plain Map: bookkeeping, never rendered (list() hands out snapshots).
	#byIcao = new Map<string, State>();

	/** A 5,0 or 6,0 reply. Returns the observation it completes; null if it has no partner yet. */
	add(
		icao: string,
		reading: Reading<TrackAndTurn | HeadingAndSpeed>,
		context: Context
	): Observation | null {
		let state = this.#byIcao.get(icao);
		if (!state) {
			state = { trackAndTurn: null, headingAndSpeed: null, winds: [], kelvins: [], snapshot: null };
			this.#byIcao.set(icao, state);
		}
		const { value } = reading;
		if (value.bds === '5,0') state.trackAndTurn = { ...reading, value };
		else state.headingAndSpeed = { ...reading, value };

		const { trackAndTurn, headingAndSpeed } = state;
		if (!trackAndTurn || !headingAndSpeed) return null;
		if (Math.abs(trackAndTurn.t - headingAndSpeed.t) > PARTNER_MAX_AGE_MS) return null;

		const o = observe(icao, {
			trackAndTurn,
			headingAndSpeed,
			altitude: context.altitude,
			position: context.position
		});
		if (o.wind && !o.windProblem)
			state.winds.push({ rx: o.rx, wind: o.wind.wind, air: o.wind.air });
		if (o.temperature && !o.temperatureProblem)
			state.kelvins.push({
				rx: o.rx,
				kelvin: o.temperature.kelvin,
				isaDeviation: o.temperature.atAltitude?.isaDeviation ?? null
			});
		this.#trim(state, o.rx);

		const old = state.snapshot;
		state.snapshot = {
			icao,
			callsign: context.callsign ?? old?.callsign ?? null,
			lastRx: o.rx,
			latest: o,
			lastWind: o.wind && !o.windProblem ? o : (old?.lastWind ?? null),
			lastTemperature: o.temperature && !o.temperatureProblem ? o : (old?.lastTemperature ?? null),
			average: average(state),
			observations: (old?.observations ?? 0) + 1,
			trustedWinds: (old?.trustedWinds ?? 0) + (o.wind && !o.windProblem ? 1 : 0)
		};
		return o;
	}

	/** Forget aircraft not heard within the TTL, and values too old for the averages. */
	prune(now: number): void {
		for (const [icao, state] of this.#byIcao) {
			const last = Math.max(state.trackAndTurn?.rx ?? 0, state.headingAndSpeed?.rx ?? 0);
			if (now - last > AIRCRAFT_TTL_MS) {
				this.#byIcao.delete(icao);
				continue;
			}
			const before = state.winds.length + state.kelvins.length;
			this.#trim(state, now);
			if (state.snapshot && state.winds.length + state.kelvins.length !== before)
				state.snapshot = { ...state.snapshot, average: average(state) };
		}
	}

	/** Aircraft with at least one observation, by address (rows don't jump around). */
	list(): WeatherAircraft[] {
		return [...this.#byIcao.values()]
			.flatMap((s) => s.snapshot ?? [])
			.sort((a, b) => a.icao.localeCompare(b.icao));
	}

	clear(): void {
		this.#byIcao.clear();
	}

	#trim(state: State, now: number): void {
		state.winds = state.winds.filter((w) => now - w.rx <= AVERAGE_MS);
		state.kelvins = state.kelvins.filter((k) => now - k.rx <= AVERAGE_MS);
	}
}

function average(state: State): Average {
	const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
	const deviations = state.kelvins.flatMap((k) => k.isaDeviation ?? []);
	return {
		wind: meanWind(state.winds.map((w) => w.wind)),
		air: state.winds.length
			? {
					north: state.winds.reduce((s, w) => s + w.air.north, 0) / state.winds.length,
					east: state.winds.reduce((s, w) => s + w.air.east, 0) / state.winds.length
				}
			: null,
		windCount: state.winds.length,
		kelvin: mean(state.kelvins.map((k) => k.kelvin)),
		temperatureCount: state.kelvins.length,
		isaDeviation: mean(deviations),
		isaCount: deviations.length
	};
}
