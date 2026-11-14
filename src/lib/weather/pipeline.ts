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
 * Shared by server and browser; state is the aircraft heard so far.
 */
import type { Checked } from '#lib/modes/address-filter.ts';
import { AdsbMemory } from '#lib/modes/adsb-memory.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import { inferRegister } from '#lib/modes/comm-b.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat, payload } from '#lib/modes/frame.ts';
import type { Inputs, Observation } from './observation';
import { AIRCRAFT_TTL_MS, WeatherTracker } from './tracker';

/** Older than this, a position or altitude isn't used. */
const POSITION_MAX_AGE_MS = 60_000;
const ALTITUDE_MAX_AGE_MS = 30_000;

export class WeatherPipeline {
	readonly tracker = new WeatherTracker();
	/** Replies that were 5,0 or 6,0 but contradicted ADS-B, and weren't used. */
	contradicted = 0;

	#reference: () => LatLon | null;
	#memory = new AdsbMemory();
	#altitudes = new Map<string, { feet: number; from: string; rx: number }>();
	/** From ADS-B or register 2,0; kept as long as the aircraft is (AIRCRAFT_TTL_MS). */
	#callsigns = new Map<string, { callsign: string; rx: number }>();

	/** `reference`: the receiver's position, for aircraft without an ADS-B position. */
	constructor(reference: () => LatLon | null) {
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
			adsb
		}).best;
		const register = best?.register;
		if (register?.bds === '2,0')
			this.#callsigns.set(addr.icao, { callsign: register.callsign, rx });
		if (register?.bds !== '5,0' && register?.bds !== '6,0') return null;
		if (!best!.comparisons.every((c) => c.ok)) {
			this.contradicted++;
			return null;
		}

		return this.tracker.add(
			addr.icao,
			{ value: register, rx, t },
			{
				altitude: this.#altitude(addr.icao, rx),
				position: this.#position(addr.icao, rx),
				callsign: this.#callsigns.get(addr.icao)?.callsign ?? null
			}
		);
	}

	prune(now: number): void {
		this.#memory.prune(now);
		this.tracker.prune(now);
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

	#position(icao: string, now: number): Inputs['position'] {
		const p = this.#memory.get(icao)?.position;
		if (p && now - p.t <= POSITION_MAX_AGE_MS) return { ...p.value, from: 'ADS-B' };
		const reference = this.#reference();
		return reference ? { ...reference, from: 'receiver' } : null;
	}
}
