/**
 * What each aircraft last broadcast via ADS-B: callsign, altitude, position, speeds, the
 * autopilot settings. Comm-B replies get compared with it (see comm-b.ts), and the tracker
 * on the home page will need the same picture.
 *
 * Feed it only DF17 messages whose CRC checked out: anything else could put one aircraft's
 * values under another one's address.
 */
import { CprPairs, decodeLocal, type LatLon } from './cpr';
import { toHex } from './frame';
import { squitter } from './squitter';

export interface Timed<T> {
	value: T;
	/** When it was received, ms (the same clock as `add`'s `t`). */
	t: number;
	/** Where it came from, e.g. "TC 19". */
	from: string;
}

export interface Broadcast {
	callsign: Timed<string> | null;
	/** Barometric (pressure) altitude, ft, from the airborne position messages (TC 9–18). */
	altitude: Timed<number> | null;
	/** GNSS height minus barometric altitude, ft (TC 19). */
	gnssMinusBaro: Timed<number> | null;
	position: Timed<LatLon> | null;
	ground: Timed<{ speed: number; track: number }> | null;
	air: Timed<{ speed: number | null; type: 'IAS' | 'TAS'; heading: number | null }> | null;
	verticalRate: Timed<{ rate: number; source: 'GNSS' | 'baro' }> | null;
	selectedAltitude: Timed<{ feet: number; source: 'MCP/FCU' | 'FMS' }> | null;
	qnh: Timed<number> | null;
	/** When the last message arrived. */
	lastSeen: number;
	/** The last few seconds of raw payloads, as hex: when was each one last sent? */
	recent: Map<string, number>;
}

/** How long raw payloads are remembered, to spot a Comm-B reply that's an exact copy. */
const RECENT_MS = 30_000;
/** Aircraft not heard from for this long are forgotten. */
const FORGET_MS = 5 * 60_000;
/** Decode single positions relative to the last one only if it's this fresh. */
const LOCAL_MS = 60_000;

export class AdsbMemory {
	#aircraft = new Map<string, Broadcast>();
	#pairs = new CprPairs();

	get(icao: string): Broadcast | null {
		return this.#aircraft.get(icao) ?? null;
	}

	/** `me` is the 56-bit payload of a valid DF17; `t` in ms. */
	add(icao: string, me: Uint8Array, t: number): void {
		let a = this.#aircraft.get(icao);
		if (!a) {
			a = {
				callsign: null,
				altitude: null,
				gnssMinusBaro: null,
				position: null,
				ground: null,
				air: null,
				verticalRate: null,
				selectedAltitude: null,
				qnh: null,
				lastSeen: t,
				recent: new Map()
			};
			this.#aircraft.set(icao, a);
		}
		a.lastSeen = t;
		a.recent.set(toHex(me), t);

		const s = squitter(me);
		if (!s) return;
		const tc = me[0] >> 3;
		const from = `TC ${tc}`;
		const stamp = <T>(value: T): Timed<T> => ({ value, t, from });

		switch (s.kind) {
			case 'identification':
				if (s.callsign && !s.callsign.includes('#')) a.callsign = stamp(s.callsign);
				break;
			case 'airborne-position': {
				if (s.altitudeSource === 'baro' && s.altitude.feet !== null)
					a.altitude = stamp(s.altitude.feet);
				if (!s.cpr) break;
				// Global decoding from an even/odd pair; else relative to the last known
				// position, which is how trackers decode every message after the first fix.
				const global = this.#pairs.add(icao, s.cpr, t);
				const last = a.position;
				const position =
					global ?? (last && t - last.t <= LOCAL_MS ? decodeLocal(s.cpr, last.value) : null);
				if (position) a.position = stamp(position);
				break;
			}
			case 'velocity':
				if (s.ground) a.ground = stamp(s.ground);
				if (s.air) a.air = stamp(s.air);
				if (s.verticalRate !== null)
					a.verticalRate = stamp({ rate: s.verticalRate, source: s.verticalRateSource });
				if (s.gnssMinusBaro !== null) a.gnssMinusBaro = stamp(s.gnssMinusBaro);
				break;
			case 'target-state':
				if (s.selectedAltitude) a.selectedAltitude = stamp(s.selectedAltitude);
				if (s.qnh !== null) a.qnh = stamp(s.qnh);
				break;
		}
	}

	/** Forget old payloads and aircraft that went quiet. */
	prune(now: number): void {
		this.#pairs.prune(now);
		for (const [icao, a] of this.#aircraft) {
			for (const [hex, t] of a.recent) if (now - t > RECENT_MS) a.recent.delete(hex);
			if (now - a.lastSeen > FORGET_MS) this.#aircraft.delete(icao);
		}
	}
}
