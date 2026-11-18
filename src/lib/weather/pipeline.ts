/**
 * From raw frames to weather observations: the part of /weather that isn't display, kept
 * here so the tests can run the capture through exactly what the page runs.
 *
 * Which replies count:
 * - DF20/21 (Comm-B) with a verified address ("known" on /frames): the reply's parity is
 *   the address XOR the CRC, so a corrupted reply looks like it came from a different,
 *   made-up aircraft. Only addresses recently heard otherwise are trusted.
 * - The register must be inferred as 5,0 or 6,0 (see /comm-b), and nothing the same
 *   aircraft broadcast via ADS-B may contradict it. A 6,0 read as 5,0 would turn Mach into
 *   a "ground speed" and make up a wind.
 *
 * Around them, the aircraft's context: its altitude (from any verified reply or ADS-B),
 * its ADS-B position (for the magnetic declination; the receiver's position if it has
 * none), and its callsign.
 *
 * For the "Now" tab it also fills `sky` (sky.ts): the trusted observations, GNSS − baro
 * from ADS-B velocity messages (TC 19, CRC-checked, with a barometric altitude from the
 * same aircraft's position messages at most COLUMN_ALTITUDE_MS older), and the pressure
 * settings from register 4,0 (same rules as 5,0/6,0) and ADS-B TC 29, and the winds from
 * turns: every ADS-B ground vector (TC 19) goes to the TurnTracker (circle.ts).
 *
 * Each wind also gets where it was measured, for the tracker map's wind barbs: the
 * aircraft's last ADS-B position, if at most MEASURED_AT_MS old, moved on to the time of
 * the wind with its ADS-B ground speed and track (10 s at 450 kt is 2.3 km; the 60 s the
 * declination may use would be 14 km).
 *
 * Runs in the browser; state is the aircraft heard so far.
 */
import { destination } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';
import type { Checked } from '#lib/modes/address-filter.ts';
import { AdsbMemory } from '#lib/modes/adsb-memory.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import { inferRegister } from '#lib/modes/comm-b.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat, payload } from '#lib/modes/frame.ts';
import type { Inputs, Observation } from './observation';
import { TurnTracker } from './circle';
import { Sky } from './sky';
import { AIRCRAFT_TTL_MS, WeatherTracker } from './tracker';
import { toVector } from './wind';

/** Older than this, a position or altitude isn't used. */
const POSITION_MAX_AGE_MS = 60_000;
const ALTITUDE_MAX_AGE_MS = 30_000;
/**
 * GNSS − baro only needs the altitude for the layer and the pressure (column.ts); the
 * difference itself the aircraft computes. Position messages come twice a second.
 */
const COLUMN_ALTITUDE_MS = 5_000;
/** A wind is put on the map only with a position at most this old (see above). */
export const MEASURED_AT_MS = 10_000;

export class WeatherPipeline {
	readonly tracker = new WeatherTracker();
	readonly sky = new Sky();
	readonly turns = new TurnTracker();
	/** Replies that were 5,0 or 6,0 but contradicted ADS-B, and weren't used. */
	contradicted = 0;

	#reference: () => LatLon;
	#memory = new AdsbMemory();
	#altitudes = new Map<string, { feet: number; from: string; rx: number }>();
	/** From ADS-B or register 2,0; kept as long as the aircraft is (AIRCRAFT_TTL_MS). */
	#callsigns = new Map<string, { callsign: string; rx: number }>();

	/** `reference`: the receiver's position, for aircraft without an ADS-B position. */
	constructor(reference: () => LatLon) {
		this.#reference = reference;
	}

	/**
	 * One frame, in arrival order. `rx` is the wall clock (ms), `t` the receiver's clock
	 * (ms): only used for the time between two replies, where it's more precise.
	 */
	add(data: Uint8Array, addr: Checked | null, rx: number, t: number): Observation | null {
		if (!addr) return null;
		const df = downlinkFormat(data);
		const mb = payload(data);

		if (df === 17 && addr.verdict === 'valid' && mb) {
			this.#memory.add(addr.icao, mb, rx);
			const a = this.#memory.get(addr.icao)!;
			if (a.callsign?.t === rx) this.#callsigns.set(addr.icao, { callsign: a.callsign.value, rx });
			if (a.altitude?.t === rx)
				this.#altitudes.set(addr.icao, { feet: a.altitude.value, from: a.altitude.from, rx });
			this.#broadcastWeather(addr.icao, rx);
			return null;
		}
		if (addr.verdict !== 'known') return null;

		const altitude = [0, 4, 16, 20].includes(df) ? replyAltitude(data).feet : null;
		if (altitude !== null)
			this.#altitudes.set(addr.icao, { feet: altitude, from: `DF${df} reply`, rx });
		if ((df !== 20 && df !== 21) || !mb) return null;

		const adsb = this.#memory.get(addr.icao);
		const best = inferRegister(mb, {
			now: rx,
			replyAltitude: df === 20 ? altitude : null,
			adsb,
			address: addr.icao // known, see above
		}).best;
		const register = best?.register;
		if (register?.bds === '2,0')
			this.#callsigns.set(addr.icao, { callsign: register.callsign, rx });
		if (register?.bds === '4,0' && register.baroSetting !== null) {
			if (best!.comparisons.every((c) => c.ok))
				this.sky.addSetting({
					icao: addr.icao,
					rx,
					hPa: register.baroSetting,
					altitude: this.#altitude(addr.icao, rx)?.feet ?? null,
					from: '4,0'
				});
			return null;
		}
		if (register?.bds !== '5,0' && register?.bds !== '6,0') return null;
		if (!best!.comparisons.every((c) => c.ok)) {
			this.contradicted++;
			return null;
		}

		const o = this.tracker.add(
			addr.icao,
			{ value: register, rx, t },
			{
				altitude: this.#altitude(addr.icao, rx),
				position: this.#position(addr.icao, rx),
				callsign: this.#callsigns.get(addr.icao)?.callsign ?? null
			}
		);
		if (o) this.sky.addObservation(o, this.#measuredAt(addr.icao, o.rx));
		return o;
	}

	/** What a DF17 that just went into the ADS-B memory adds to the sky. */
	#broadcastWeather(icao: string, rx: number): void {
		const a = this.#memory.get(icao)!;
		if (a.gnssMinusBaro?.t === rx && a.altitude && rx - a.altitude.t <= COLUMN_ALTITUDE_MS) {
			const position = this.#position(icao, rx);
			this.sky.addColumn(icao, rx, a.altitude.value, a.gnssMinusBaro.value, position);
		}
		if (a.ground?.t === rx) {
			const altitude =
				a.altitude && rx - a.altitude.t <= COLUMN_ALTITUDE_MS
					? a.altitude.value
					: (this.#altitude(icao, rx)?.feet ?? null);
			const turn = this.turns.add(icao, {
				t: rx,
				vector: toVector(a.ground.value.speed, a.ground.value.track),
				altitude
			});
			if (turn) this.sky.addTurn(turn, this.#measuredAt(icao, turn.end));
		}
		if (a.qnh?.t === rx)
			this.sky.addSetting({
				icao,
				rx,
				hPa: a.qnh.value,
				altitude: this.#altitude(icao, rx)?.feet ?? null,
				from: 'TC 29'
			});
	}

	prune(now: number): void {
		this.#memory.prune(now);
		this.tracker.prune(now);
		for (const turn of this.turns.prune(now))
			this.sky.addTurn(turn, this.#measuredAt(turn.icao, turn.end));
		this.sky.prune(now);
		for (const [icao, a] of this.#altitudes) {
			if (now - a.rx > ALTITUDE_MAX_AGE_MS) this.#altitudes.delete(icao);
		}
		for (const [icao, c] of this.#callsigns) {
			if (now - c.rx > AIRCRAFT_TTL_MS) this.#callsigns.delete(icao);
		}
	}

	#altitude(icao: string, now: number): Inputs['altitude'] {
		const a = this.#altitudes.get(icao);
		return a && now - a.rx <= ALTITUDE_MAX_AGE_MS ? { feet: a.feet, from: a.from } : null;
	}

	/** Where the aircraft was at `t`: see the top of this file. */
	#measuredAt(icao: string, t: number): LatLon | null {
		const a = this.#memory.get(icao);
		const p = a?.position;
		if (!p || Math.abs(t - p.t) > MEASURED_AT_MS) return null;
		const ground = a.ground && Math.abs(a.ground.t - p.t) <= MEASURED_AT_MS ? a.ground : null;
		if (!ground) return p.value;
		const hours = (t - p.t) / 3_600_000;
		return destination(p.value, ground.value.track, ground.value.speed * KM_PER_NM * hours);
	}

	#position(icao: string, now: number): Inputs['position'] {
		const p = this.#memory.get(icao)?.position;
		if (p && now - p.t <= POSITION_MAX_AGE_MS) return { ...p.value, from: 'ADS-B' };
		return { ...this.#reference(), from: 'receiver' };
	}
}
