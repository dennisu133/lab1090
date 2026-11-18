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
 * - Values from radar replies need a second opinion before they replace what we have (see
 *   #fromReply). The address check above is weaker than it looks, because the demodulator
 *   passes such replies only if their address matches an aircraft it knows (demod/filter.ts;
 *   readsb does the same with --connect): of the many replies that noise corrupted, the few
 *   whose garbled checksum happens to give a known address are exactly the ones that get
 *   through. In the capture, one DF16 reply put CCA749 at
 *   73,400 ft, on the ground (it was cruising at FL380). ADS-B has its own checksum (CRC)
 *   and needs no second opinion.
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
 * Alerts (alerts.ts): the emergency state and squawk, ACAS resolution advisories and IDENT
 * are kept as streaks: the value, and how many messages in a row said so. An alert needs
 * two, so one message can't raise one (see alerts.ts for why).
 *
 * Turns: the tracker measures how fast each aircraft's ground track changes (TURN_WINDOW_MS,
 * see #turn), for dead reckoning along the arc and the predicted path (motion.ts, drawn by
 * lib/map/features.ts).
 *
 * Immutable snapshots, like /comm-b's aircraft list: every change makes a new object, so a
 * page holding the list in $state.raw re-renders only what changed.
 *
 * Shared by server and browser; state is the aircraft heard so far.
 */
import { inEffect, type ResolutionAdvisory } from '#lib/modes/acas.ts';
import type { Checked } from '#lib/modes/address-filter.ts';
import { AdsbMemory, type Provenance, type Timed } from '#lib/modes/adsb-memory.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import { inferRegister } from '#lib/modes/comm-b.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { bits, downlinkFormat, payload } from '#lib/modes/frame.ts';
import { airAirPayload, flightStatus } from '#lib/modes/header.ts';
import type { EmitterCategory } from '#lib/modes/identification.ts';
import { allocation, formatRegistration, nationalityMark } from '#lib/modes/nationality.ts';
import { movement, type Cpr, type Movement } from '#lib/modes/position.ts';
import type { HeadingAndSpeed, TrackAndTurn, VerticalIntention } from '#lib/modes/registers.ts';
import { replySquawk } from '#lib/modes/squawk.ts';
import { squitter } from '#lib/modes/squitter.ts';
import type { OperationalStatus, TargetStateV2 } from '#lib/modes/status.ts';
import type { Velocity } from '#lib/modes/velocity.ts';
import { Positions, type Located, type Outcome } from './positions';
import { extend, prune, type Trail } from './trail';

/** Aircraft not heard for this long are dropped (the same minute as the address filter). */
export const AIRCRAFT_TTL_MS = 60_000;
/** A ground speed older than this isn't used for the speed check. */
const GROUND_SPEED_MS = 30_000;
/** Radar replies: a value replaces the current one if that's older than this, or see below. */
const REPLY_CURRENT_MS = 60_000;
/** A value waiting for a second reply to confirm it waits this long. */
const REPLY_PENDING_MS = 30_000;
/**
 * The fastest altitude change believed from replies: steeper than any normal descent
 * (an emergency descent is 6,000–8,000 ft/min), plus 500 ft for the 100 ft steps of the
 * old Gillham code and the time between replies.
 */
const MAX_FT_PER_MIN = 10_000;
/** How many rejected positions are kept (a tab stays open for days). */
const MAX_REJECTIONS = 100;
const ALTITUDE_SLACK_FT = 500;

/** A trail point takes the altitude if it's at most this old (position messages carry it). */
const TRAIL_ALTITUDE_MS = 10_000;

/**
 * The turn rate is measured over the ground tracks of this long (#turn): long enough to
 * average out the velocity's 1 kt steps, short enough to see a turn start within seconds.
 * Velocity messages come twice a second; this receiver catches about one a second.
 */
export const TURN_WINDOW_MS = 10_000;
/** …from at least this many tracks, spanning at least TURN_MIN_SPAN_MS. */
const TURN_MIN_SAMPLES = 3;
const TURN_MIN_SPAN_MS = 4_000;

/**
 * Advisories more than this far apart are separate streaks: while ACAS gives one, TC 28
 * subtype 2 goes out about once a second (DO-260B), so a 10 s silence means
 * it's over or out of reach.
 */
export const ADVISORY_GAP_MS = 10_000;
/** The SPI bit stays set for 18 s after the pilot presses IDENT (ICAO Annex 10 Vol IV). */
export const IDENT_GAP_MS = 20_000;

/** A value, and how many messages in a row said so (alerts.ts wants two). */
/** A radar reply's value waiting for a second, agreeing one (#fromReply). */
interface Pending {
	value: string | number;
	t: number;
}

export interface Streak<T> extends Timed<T> {
	/** When the first of them arrived. */
	since: number;
	count: number;
}

/**
 * The next streak: one more if `value` is the same as the old one's (`same`) and came within
 * `gap` ms of it, else a new one of `count` (a reply value confirmed by an earlier one: 2).
 */
function streak<T>(
	old: Streak<T> | null,
	value: T,
	t: number,
	from: Provenance,
	same: (a: T, b: T) => boolean = (a, b) => a === b,
	gap = Infinity,
	count = 1
): Streak<T> {
	if (old && same(old.value, value) && t - old.t <= gap)
		return { value, t, from, since: old.since, count: old.count + 1 };
	return { value, t, from, since: t, count };
}

/** Advisories continue a streak while both are, or both aren't, in effect. */
const sameEffect = (a: ResolutionAdvisory, b: ResolutionAdvisory) => inEffect(a) === inEffect(b);

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
	/** From Comm-B 2,1, with the dash put back ("D-AIZA"). Rare: radars here don't ask for it. */
	registration: Timed<string> | null;
	category: Timed<EmitterCategory> | null;
	squawk: Streak<string> | null;
	/**
	 * TC 28 subtype 1: the emergency/priority state (EMERGENCY_STATES: 0 none, 1 general, 2
	 * medical, 3 minimum fuel, 4 no communications, 5 unlawful interference, 6 downed).
	 */
	emergency: Streak<number> | null;
	/**
	 * The latest ACAS resolution advisory, from TC 28 subtype 2, Comm-B 3,0 or a DF16
	 * coordination reply (acas.ts). The streak counts messages in a row that agree on whether
	 * one is in effect, at most ADVISORY_GAP_MS apart.
	 */
	advisory: Streak<ResolutionAdvisory> | null;
	/**
	 * The pilot pressed IDENT: the SPI bit (SS 3 in TC 9–18, FS 4/5 in replies). Null once a
	 * message says it's off.
	 */
	ident: Streak<true> | null;
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
	/** Over the ground (TC 19 subtypes 1/2): what moves the dot on the map. */
	ground: Timed<{ speed: number; track: number }> | null;
	/**
	 * How fast the ground track changes, degrees per second, positive = turning right. Measured
	 * from the TC 19 tracks of the last TURN_WINDOW_MS (a straight line fitted to them);
	 * null without enough of them.
	 */
	turnRate: Timed<number> | null;
	/**
	 * Through the air (TC 19 subtypes 3/4): sent instead of the ground speed by aircraft that
	 * can't measure that, i.e. without a satellite fix. The heading is relative to true or
	 * magnetic north (see headingReference).
	 */
	air: Timed<NonNullable<Velocity['air']>> | null;
	verticalRate: Timed<{ rate: number; source: 'gnss' | 'baro' }> | null;
	/**
	 * From the operational status (TC 31): the ADS-B version (decides how other messages are
	 * read), the heading reference, and what the integrity of positions needs (integrity.ts).
	 */
	operational: Timed<
		Pick<OperationalStatus, 'version' | 'hrd' | 'sil' | 'silSupplement'> & {
			nicA: number | null;
			nicC: number | null;
		}
	> | null;
	/** NACp, the position's 95 % accuracy (integrity.ts): from TC 31 or TC 29, the latest. */
	nacP: Timed<number> | null;
	/** The latest position message's type code and NIC-B bit: its integrity (integrity.ts). */
	positionCode: Timed<{ tc: number; nicB: number }> | null;
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
		registration: null,
		category: null,
		squawk: null,
		emergency: null,
		advisory: null,
		ident: null,
		altitude: null,
		gnssHeight: null,
		onGround: null,
		surface: null,
		ground: null,
		turnRate: null,
		air: null,
		verticalRate: null,
		operational: null,
		nacP: null,
		positionCode: null,
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
	/** Recent ground tracks per aircraft, oldest first, for the turn rate (#turn). */
	#tracks = new Map<string, { t: number; track: number }[]>();
	/** Reply values waiting for confirmation, per `${icao} ${field}`. */
	#pending = new Map<string, Pending>();
	/** Reply values that weren't taken (yet): the tests read this. */
	heldBack = 0;
	/** The latest MAX_REJECTIONS positions that failed the checks: the tests read them. */
	readonly rejections: { icao: string; outcome: Outcome }[] = [];

	/** `receiver`: the antenna's position, for the range check and surface pairs. */
	constructor(receiver: () => LatLon) {
		this.#positions = new Positions(receiver);
	}

	get(icao: string): TrackedAircraft | null {
		return this.#aircraft.get(icao) ?? null;
	}

	/** How many aircraft are kept (heard within AIRCRAFT_TTL_MS). */
	get size(): number {
		return this.#aircraft.size;
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
		const from: Provenance = { kind: 'reply', df };
		if ([0, 4, 16, 20].includes(df)) {
			const feet = replyAltitude(data).feet;
			const close = (b: Pending) =>
				Math.abs(feet! - (b.value as number)) <=
				ALTITUDE_SLACK_FT + (MAX_FT_PER_MIN * Math.abs(t - b.t)) / 60_000;
			if (feet !== null && this.#fromReply(a.icao, 'altitude', a.altitude, feet, t, close))
				a.altitude = { value: feet, t, from };
		}
		if (df === 5 || df === 21) {
			const squawk = replySquawk(data);
			const same = (b: Pending) => b.value === squawk;
			const taken = this.#fromReply(a.icao, 'squawk', a.squawk, squawk, t, same);
			// Confirmed by a waiting reply: that one started the streak.
			if (taken === 'current') a.squawk = streak(a.squawk, squawk, t, from);
			else if (taken) a.squawk = { value: squawk, t, from, since: taken.pending, count: 2 };
		}
		// FS (bits 6–8): codes 4 and 5 carry SPI. DF0/16 have no FS.
		if ([4, 5, 20, 21].includes(df))
			a = this.#ident(a, flightStatus(bits(data, 6, 3)).spi, t, from);
		// DF16 MV with VDS 0x30: the aircraft's own RA, as its ACAS tells another one's.
		const mv = df === 16 && mb ? airAirPayload(mb) : null;
		if (mv?.kind === 'acas') a.advisory = this.#advisory(a.advisory, mv.advisory, t, from);
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
				this.#tracks.delete(icao);
				for (const field of ['altitude', 'squawk', 'callsign'])
					this.#pending.delete(`${icao} ${field}`);
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
		const from: Provenance = { kind: 'adsb', tc: me[0] >> 3 };
		const stamp = <T>(value: T): Timed<T> => ({ value, t, from });

		switch (s.kind) {
			case 'identification':
				if (!s.callsign.includes('#')) a.callsign = stamp(s.callsign);
				a.category = stamp(s.category);
				break;
			case 'surface-position':
				a.onGround = true;
				a.positionCode = stamp({ tc: s.tc, nicB: 0 });
				// The movement's codes 1–8 changed with version 2: read by the aircraft's own
				// version once its operational status said it (until then as version 2).
				a.surface = stamp({
					movement: movement(s.movement.code, a.operational?.value.version ?? 2),
					direction: s.track
				});
				return this.#position(a, s.cpr, t, true);
			case 'airborne-position': {
				a.onGround = false;
				// SS (surveillance status) 3: SPI. 1 and 2 are the alert flags, which the
				// squawk says more precisely.
				a = this.#ident(a, s.surveillanceStatus === 3, t, from);
				const feet = s.altitude.feet;
				if (feet !== null) {
					if (s.altitudeSource === 'baro') a.altitude = stamp(feet);
					else a.gnssHeight = stamp(feet);
				}
				if (s.cpr) {
					a.positionCode = stamp({ tc: s.tc, nicB: s.nicB });
					return this.#position(a, s.cpr, t);
				}
				break;
			}
			case 'velocity':
				if (s.ground) {
					a.ground = stamp(s.ground);
					a.turnRate = this.#turn(a.icao, s.ground.track, t, from);
				}
				if (s.air) a.air = stamp(s.air);
				if (s.verticalRate !== null)
					a.verticalRate = stamp({ rate: s.verticalRate, source: s.verticalRateSource });
				break;
			case 'aircraft-status':
				if (s.squawk) a.squawk = streak(a.squawk, s.squawk, t, from);
				if (s.emergency !== null) a.emergency = streak(a.emergency, s.emergency, t, from);
				if (s.advisory) a.advisory = this.#advisory(a.advisory, s.advisory, t, from);
				break;
			case 'operational-status':
				a.operational = stamp({
					version: s.version,
					hrd: s.hrd,
					sil: s.sil,
					silSupplement: s.silSupplement,
					nicA: s.nicSupplementA,
					nicC: s.capabilities?.nicSupplementC ?? null
				});
				if (s.nacP !== null) a.nacP = stamp(s.nacP);
				break;
			case 'target-state':
				if (s.subtype === 1) {
					const { selectedAltitude, selectedHeading, qnh, modes } = s;
					a.target = stamp({ selectedAltitude, selectedHeading, qnh, modes });
					a.nacP = stamp(s.nacP);
				}
				break;
		}
		return a;
	}

	/**
	 * The turn rate from the ground tracks of the last TURN_WINDOW_MS: the slope of a straight
	 * line fitted to track over time (least squares), so no single track decides. Tracks are
	 * unwrapped first (359° → 1° is +2°, not −358°). In the capture, aircraft flying straight
	 * come out within ±0.04°/s; the two course changes in it turned at up to 0.4 and 0.8°/s.
	 */
	#turn(icao: string, track: number, t: number, from: Provenance): Timed<number> | null {
		const recent = (this.#tracks.get(icao) ?? []).filter((s) => t - s.t <= TURN_WINDOW_MS);
		recent.push({ t, track });
		this.#tracks.set(icao, recent);
		if (recent.length < TURN_MIN_SAMPLES || t - recent[0].t < TURN_MIN_SPAN_MS) return null;
		let unwrapped = recent[0].track;
		const points = recent.map((s, i) => {
			if (i > 0) unwrapped += ((s.track - recent[i - 1].track + 540) % 360) - 180;
			return { x: (s.t - t) / 1000, y: unwrapped };
		});
		const mx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
		const my = points.reduce((sum, p) => sum + p.y, 0) / points.length;
		let sxy = 0;
		let sxx = 0;
		for (const p of points) {
			sxy += (p.x - mx) * (p.y - my);
			sxx += (p.x - mx) ** 2;
		}
		return { value: sxy / sxx, t, from };
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
			if (this.rejections.length > MAX_REJECTIONS) this.rejections.shift();
			a.lastRejection = { value: outcome.reason, t, from: { kind: 'position check' } };
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

	/**
	 * Should a value from a radar reply be taken? Yes if it agrees with the current one
	 * (`agrees`: equal, or for the altitude, reachable in the time between), or if there's no
	 * current one within REPLY_CURRENT_MS and a second reply agrees with this one. Otherwise
	 * it waits for that second reply. So one corrupted reply changes nothing, and a real
	 * change (a new squawk from ATC) shows from the second reply on.
	 *
	 * Returns what agreed: 'current', or the time of the waiting reply; null: not taken.
	 */
	#fromReply(
		icao: string,
		field: string,
		current: Timed<string | number> | null,
		value: string | number,
		t: number,
		agrees: (other: Pending) => boolean
	): 'current' | { pending: number } | null {
		const key = `${icao} ${field}`;
		if (current && t - current.t <= REPLY_CURRENT_MS && agrees(current)) {
			this.#pending.delete(key);
			return 'current';
		}
		const pending = this.#pending.get(key);
		if (pending && t - pending.t <= REPLY_PENDING_MS && agrees(pending)) {
			this.#pending.delete(key);
			return { pending: pending.t };
		}
		this.#pending.set(key, { value, t });
		this.heldBack++;
		return null;
	}

	/** SPI on or off, from a message that carries the bit. */
	#ident(a: TrackedAircraft, spi: boolean, t: number, from: Provenance): TrackedAircraft {
		a.ident = spi ? streak<true>(a.ident, true, t, from, () => true, IDENT_GAP_MS) : null;
		return a;
	}

	#advisory(
		old: Streak<ResolutionAdvisory> | null,
		r: ResolutionAdvisory,
		t: number,
		from: Provenance
	): Streak<ResolutionAdvisory> {
		return streak(old, r, t, from, sameEffect, ADVISORY_GAP_MS);
	}

	#commB(a: TrackedAircraft, data: Uint8Array, mb: Uint8Array, t: number): TrackedAircraft {
		const df = downlinkFormat(data);
		const best = inferRegister(mb, {
			now: t,
			replyAltitude: df === 20 ? replyAltitude(data).feet : null,
			adsb: this.#memory.get(a.icao),
			address: a.icao // the tracker only counts replies from known addresses
		}).best;
		if (!best || !best.comparisons.every((c) => c.ok)) return a;
		const r = best.register;
		const from: Provenance = { kind: 'comm-b', bds: r.bds };
		const stamped = <T>(value: T): Timed<T> => ({ value, t, from });
		if (r.bds === '2,0') {
			const same = (b: Pending) => b.value === r.callsign;
			// ADS-B's callsign has a CRC: a different one in a reply is more likely corrupted.
			const adsb = a.callsign?.from.kind === 'adsb' ? a.callsign : null;
			if (adsb ? same(adsb) : this.#fromReply(a.icao, 'callsign', a.callsign, r.callsign, t, same))
				a.callsign = stamped(r.callsign);
		}
		if (r.bds === '2,1') {
			// Inference only accepts a 2,1 that starts with one of these marks (comm-b.ts).
			const marks = allocation(a.icao)?.marks ?? [];
			const mark = nationalityMark(r.registration, marks);
			if (mark) a.registration = stamped(formatRegistration(r.registration, mark));
		}
		if (r.bds === '3,0') a.advisory = this.#advisory(a.advisory, r, t, from);
		if (r.bds === '4,0') a.commB = { ...a.commB, intention: stamped(r) };
		if (r.bds === '5,0') a.commB = { ...a.commB, trackAndTurn: stamped(r) };
		if (r.bds === '6,0') a.commB = { ...a.commB, headingAndSpeed: stamped(r) };
		return a;
	}
}
