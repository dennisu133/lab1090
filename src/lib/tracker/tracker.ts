/**
 * The tracker's picture of the sky: every aircraft heard in the last minute, with what it
 * said about itself and where it is. The home page's map draws this.
 *
 * Which frames count (the same rules as /comm-b and /weather):
 *
 * - DF17 (ADS-B) with a correct CRC: identity, position, velocity, autopilot settings.
 * - DF11 (all-call replies) with a correct CRC: only that the aircraft is there.
 * - DF0/4/5/16/20/21 with a verified address ("known" on /frames): their address is hidden
 *   in the parity, so a corrupted reply looks like a made-up aircraft. Only addresses heard
 *   in a DF11/17 within the last minute are trusted. These give the altitude (DF0/4/16/20)
 *   and the squawk (DF5/21), and DF20/21 the Comm-B registers: the callsign (2,0), and the
 *   EHS registers (4,0, 5,0, 6,0) if nothing the aircraft broadcast contradicts them.
 * - DF18 is left out for now: it comes from devices without a transponder, or from ground
 *   stations relaying other traffic (TIS-B, ADS-R), and hardly occurs in Europe.
 *
 * Some aircraft have no position. Older transponders without ADS-B answer radars (altitude,
 * squawk) but never say where they are, and a single receiver can't work it out (that takes
 * several receivers timing the same message: multilateration). And some send ADS-B without
 * one: TC 0 means "no position information", e.g. while the GNSS receiver has no fix (in
 * the capture, CCA749 sent only those). They're on the list anyway.
 *
 * Surface positions (TC 5–8) count too: an aircraft on the ground sends those instead of
 * airborne ones (no altitude; a speed and a direction instead). Rare here: on the ground,
 * the radio horizon is a few km, so only an airfield near the antenna is in view.
 *
 * Immutable snapshots, like /comm-b's aircraft list: every change makes a new object, so a
 * page holding the list in $state.raw re-renders only what changed.
 *
 * Shared by server and browser; state is the aircraft heard so far.
 */
import type { Checked } from '#lib/modes/address-filter.ts';
import { AdsbMemory, type Timed } from '#lib/modes/adsb-memory.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import { inferRegister } from '#lib/modes/comm-b.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat, payload } from '#lib/modes/frame.ts';
import type { EmitterCategory } from '#lib/modes/identification.ts';
import type { Cpr, Movement } from '#lib/modes/position.ts';
import type { HeadingAndSpeed, TrackAndTurn, VerticalIntention } from '#lib/modes/registers.ts';
import { replySquawk } from '#lib/modes/squawk.ts';
import { squitter } from '#lib/modes/squitter.ts';
import type { TargetStateV2 } from '#lib/modes/status.ts';
import { Positions, type Located, type Outcome } from './positions';
import { extend, prune, type Trail } from './trail';

/** Aircraft not heard for this long are dropped (the same minute as the address filter). */
export const AIRCRAFT_TTL_MS = 60_000;
/** A ground speed older than this isn't used for the speed check. */
const GROUND_SPEED_MS = 30_000;
/** A trail point takes the altitude if it's at most this old (position messages carry it). */
const TRAIL_ALTITUDE_MS = 10_000;

export interface TrackedAircraft {
	/** 24-bit ICAO address, as hex (uppercase, like the address filter's). */
	icao: string;
	firstSeen: number;
	lastSeen: number;
	/** Frames counted for it (see the rules above). */
	messages: number;
	/** Signal level of the latest frame, dBFS; null if not given. */
	signal: number | null;
	/** Has it sent ADS-B (DF17)? Without, it can't have a position. */
	adsb: boolean;

	callsign: Timed<string> | null;
	category: Timed<EmitterCategory> | null;
	squawk: Timed<string> | null;
	/** Barometric (pressure) altitude, ft: ADS-B TC 9–18, or a radar reply's AC field. */
	altitude: Timed<number> | null;
	/** GNSS height above the WGS84 ellipsoid, ft (TC 20–22, rare). */
	gnssHeight: Timed<number> | null;
	/** From the latest position message: surface (TC 5–8) or airborne. null: none yet. */
	onGround: boolean | null;
	/**
	 * On the ground (TC 5–8): speed as a range (the MOV field's steps), and the direction,
	 * which is the ground track or the heading (the operational status's TAH bit says which).
	 */
	surface: Timed<{ movement: Movement; direction: number | null }> | null;
	/** Over the ground (TC 19): what moves the dot on the map. */
	ground: Timed<{ speed: number; track: number }> | null;
	verticalRate: Timed<{ rate: number; source: 'GNSS' | 'baro' }> | null;
	/** What the autopilot is set to (TC 29, ADS-B version 2). */
	target: Timed<
		Pick<TargetStateV2, 'selectedAltitude' | 'selectedHeading' | 'qnh' | 'modes'>
	> | null;

	/** The latest believed position (positions.ts); null if none (yet). */
	position: Located | null;
	/** Did the next position agree with the first fix? The map shows only confirmed ones. */
	confirmed: boolean;
	/** Positions that failed the checks, since it appeared. */
	rejected: number;
	/** The last reason, for the tooltip. */
	lastRejection: Timed<string> | null;
	trail: Trail;

	/** Enhanced Surveillance (EHS) registers that radars read, each only if ADS-B agrees. */
	commB: {
		intention: Timed<VerticalIntention> | null;
		trackAndTurn: Timed<TrackAndTurn> | null;
		headingAndSpeed: Timed<HeadingAndSpeed> | null;
	};
}

function blank(icao: string, t: number): TrackedAircraft {
	return {
		icao,
		firstSeen: t,
		lastSeen: t,
		messages: 0,
		signal: null,
		adsb: false,
		callsign: null,
		category: null,
		squawk: null,
		altitude: null,
		gnssHeight: null,
		onGround: null,
		surface: null,
		ground: null,
		verticalRate: null,
		target: null,
		position: null,
		confirmed: false,
		rejected: 0,
		lastRejection: null,
		trail: [],
		commB: { intention: null, trackAndTurn: null, headingAndSpeed: null }
	};
}

export class Tracker {
	// Plain Maps: bookkeeping, never rendered (list() hands out snapshots).
	#aircraft = new Map<string, TrackedAircraft>();
	#positions: Positions;
	/** For Comm-B inference: replies are compared with what the aircraft broadcast (comm-b.ts). */
	#memory = new AdsbMemory();
	/** Positions that failed the checks: the tests read them, the page may show them later. */
	readonly rejections: { icao: string; outcome: Outcome }[] = [];

	/** `receiver`: the antenna's position, for the range check (null: no range check). */
	constructor(receiver: () => LatLon | null) {
		this.#positions = new Positions(receiver);
	}

	get(icao: string): TrackedAircraft | null {
		return this.#aircraft.get(icao) ?? null;
	}

	/** Every aircraft heard within AIRCRAFT_TTL_MS, by address. */
	list(): TrackedAircraft[] {
		return [...this.#aircraft.values()].sort((a, b) => a.icao.localeCompare(b.icao));
	}

	/**
	 * One frame, in arrival order (CPR pairs depend on it). `t`: when it arrived, ms (the
	 * server's clock). `signal`: its level in dBFS, if known. Returns whether it counted.
	 */
	add(data: Uint8Array, addr: Checked | null, t: number, signal: number | null = null): boolean {
		if (!addr) return false;
		const df = downlinkFormat(data);
		const valid = addr.verdict === 'valid' && (df === 11 || df === 17);
		if (!valid && addr.verdict !== 'known') return false;

		const old = this.#aircraft.get(addr.icao) ?? blank(addr.icao, t);
		let a: TrackedAircraft = { ...old, lastSeen: t, messages: old.messages + 1, signal };
		const mb = payload(data);
		if (df === 17 && mb) a = this.#adsb(a, mb, t);
		if ([0, 4, 16, 20].includes(df)) {
			const feet = replyAltitude(data).feet;
			if (feet !== null) a.altitude = { value: feet, t, from: `DF${df} reply` };
		}
		if (df === 5 || df === 21) a.squawk = { value: replySquawk(data), t, from: `DF${df} reply` };
		if ((df === 20 || df === 21) && mb) a = this.#commB(a, data, mb, t);
		this.#aircraft.set(addr.icao, a);
		return true;
	}

	/** Drop aircraft not heard within AIRCRAFT_TTL_MS, and old trail points. */
	prune(now: number): void {
		this.#memory.prune(now);
		this.#positions.prune(now);
		for (const [icao, a] of this.#aircraft) {
			if (now - a.lastSeen > AIRCRAFT_TTL_MS) {
				this.#aircraft.delete(icao);
				this.#positions.delete(icao);
				continue;
			}
			const trail = prune(a.trail, now);
			if (trail !== a.trail) this.#aircraft.set(icao, { ...a, trail });
		}
	}

	#adsb(a: TrackedAircraft, me: Uint8Array, t: number): TrackedAircraft {
		this.#memory.add(a.icao, me, t);
		a.adsb = true;
		const s = squitter(me);
		const from = `TC ${me[0] >> 3}`;
		const stamp = <T>(value: T): Timed<T> => ({ value, t, from });

		switch (s.kind) {
			case 'identification':
				if (!s.callsign.includes('#')) a.callsign = stamp(s.callsign);
				a.category = stamp(s.category);
				break;
			case 'surface-position':
				a.onGround = true;
				a.surface = stamp({ movement: s.movement, direction: s.track });
				return this.#position(a, s.cpr, t, true);
			case 'airborne-position': {
				a.onGround = false;
				const feet = s.altitude.feet;
				if (feet !== null) {
					if (s.altitudeSource === 'baro') a.altitude = stamp(feet);
					else a.gnssHeight = stamp(feet);
				}
				if (s.cpr) return this.#position(a, s.cpr, t);
				break;
			}
			case 'velocity':
				if (s.ground) a.ground = stamp(s.ground);
				if (s.verticalRate !== null)
					a.verticalRate = stamp({ rate: s.verticalRate, source: s.verticalRateSource });
				break;
			case 'aircraft-status':
				if (s.squawk) a.squawk = stamp(s.squawk);
				break;
			case 'target-state':
				if (s.subtype === 1) {
					const { selectedAltitude, selectedHeading, qnh, modes } = s;
					a.target = stamp({ selectedAltitude, selectedHeading, qnh, modes });
				}
				break;
		}
		return a;
	}

	#position(a: TrackedAircraft, cpr: Cpr, t: number, surface = false): TrackedAircraft {
		// On the ground: the top of the movement step (null above 175 kt: the generous limit).
		const speed = surface
			? (a.surface?.value.movement.speed?.max ?? null)
			: a.ground && t - a.ground.t <= GROUND_SPEED_MS
				? a.ground.value.speed
				: null;
		const outcome = this.#positions.add(a.icao, cpr, t, speed, surface);
		// Even when waiting: a stale position was dropped, so it's no longer confirmed. The
		// snapshot keeps it as the last known position (with its age), but the map hides it.
		const state = this.#positions.get(a.icao)!;
		a.confirmed = state.confirmed;
		a.rejected = state.rejected;
		if (outcome.kind === 'waiting') return a;
		if (outcome.kind === 'rejected' || outcome.kind === 'restart') {
			this.rejections.push({ icao: a.icao, outcome });
			a.lastRejection = { value: outcome.reason, t, from: 'position check' };
		}
		if (outcome.kind === 'rejected') return a;

		const p = outcome.position;
		a.position = p;
		const altitude =
			!surface && a.altitude && t - a.altitude.t <= TRAIL_ALTITUDE_MS ? a.altitude.value : null;
		a.trail = extend(
			a.trail,
			{ lat: p.lat, lon: p.lon, altitude, ground: surface, t },
			outcome.kind !== 'moved'
		);
		return a;
	}

	#commB(a: TrackedAircraft, data: Uint8Array, mb: Uint8Array, t: number): TrackedAircraft {
		const df = downlinkFormat(data);
		const best = inferRegister(mb, {
			now: t,
			replyAltitude: df === 20 ? replyAltitude(data).feet : null,
			adsb: this.#memory.get(a.icao)
		}).best;
		if (!best || !best.comparisons.every((c) => c.ok)) return a;
		const r = best.register;
		const stamped = <T>(value: T): Timed<T> => ({ value, t, from: r.bds });
		if (r.bds === '2,0') a.callsign = stamped(r.callsign);
		if (r.bds === '4,0') a.commB = { ...a.commB, intention: stamped(r) };
		if (r.bds === '5,0') a.commB = { ...a.commB, trackAndTurn: stamped(r) };
		if (r.bds === '6,0') a.commB = { ...a.commB, headingAndSpeed: stamped(r) };
		return a;
	}
}
