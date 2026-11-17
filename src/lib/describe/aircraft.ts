/**
 * The tracker's detail panel: everything known about one aircraft, in sections, each value
 * with an explanation of what it is, where it came from and what it means. The tracker
 * works on phones too, so the panel shows these explanations as tappable InfoTips, not as
 * hover titles: every field here has a `label`.
 */
import { bearing, compass, distanceKm, KM_PER_NM } from '#lib/geo.ts';
import { airlineDesignator, type DbAircraft, type DbFlight } from '#lib/aircraft-db.ts';
import type { Timed } from '#lib/modes/adsb-memory.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { categoryNames } from '#lib/modes/identification.ts';
import { allocation } from '#lib/modes/nationality.ts';
import { SPECIAL_SQUAWKS } from '#lib/modes/squawk.ts';
import { headingReference, motion, TURNING, trueHeading } from '#lib/tracker/motion.ts';
import { MAX_RANGE_KM } from '#lib/tracker/positions.ts';
import { alertsOf, identing, type Tier } from '#lib/tracker/alerts.ts';
import type { Judged } from '#lib/tracker/route.ts';
import { TURN_WINDOW_MS, type TrackedAircraft } from '#lib/tracker/tracker.ts';
import { uncertainty } from '#lib/tracker/uncertainty.ts';
import type { HeadingCheck } from '#lib/weather/headings.ts';
import type { Layer } from '#lib/weather/profile.ts';
import type { WeatherAircraft } from '#lib/weather/tracker.ts';
import {
	EXTRAPOLATE_MS,
	flightLevel,
	SHOW_MS,
	shownPosition,
	type Unit
} from '#lib/map/features.ts';
import { alertSection, identField } from './alert';
import { contrailField } from './contrail';
import type { Field } from './field';
import { routeSection } from './route';
import { weatherHereFields } from './weather';

/** A row in the panel. */
export type PanelField = Omit<Field, 'title'> & {
	label: string;
	/** The explanation; none for values that explain themselves (Route, Messages, …). */
	title?: string;
	/** A few plain words after the value, dimmed: what a code stands for ("1000 · conspicuity code"). */
	note?: string;
	/** Every possible value, the one sent marked: a table under the explanation. */
	choices?: { key: string; text: string; current: boolean }[];
};

export interface Section {
	title: string;
	/** Where the values come from when we didn't decode them ourselves: "adsbdb". */
	source?: string;
	fields: PanelField[];
	/** An alert's section: its colour. */
	tier?: Tier;
}

const n = (x: number) => Math.round(x).toLocaleString('en');
const signed = (x: number) => (x > 0 ? `+${n(x)}` : x < 0 ? `−${n(-x)}` : '0');
const deg = (x: number) => `${String(Math.round(x) % 360).padStart(3, '0')}°`;

/** "4 s ago", "2 min ago". */
export function ago(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 120 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** Where a value came from, for the end of a tooltip. */
function source<T>(v: Timed<T>, now: number): string {
	const what =
		v.from === 'position check'
			? 'the position check'
			: v.from.startsWith('TC')
				? `ADS-B (${v.from})`
				: v.from.startsWith('DF')
					? `a radar ${v.from.replace('DF', 'DF ')}`
					: `Comm-B register ${v.from}, read by a radar`;
	return ` From ${what}, ${ago(now - v.t)}.`;
}

/** Whole units, or one decimal below 10 (dead reckoning moves aircraft by fractions of a mile). */
export function distanceText(km: number, unit: Unit): string {
	const d = unit === 'NM' ? km / KM_PER_NM : km;
	return `${d < 10 ? d.toFixed(1) : n(d)} ${unit}`;
}

/** "30 m", "0.3 NM (556 m)": metres up to 100, then nautical miles as well. */
function radius(metres: number): string {
	if (metres < 100) return `${n(metres)} m`;
	const nm = metres / 1852;
	const m = metres < 10_000 ? `${n(metres)} m` : `${n(metres / 1000)} km`;
	return `${nm < 1 ? Number(nm.toFixed(2)) : n(nm)} NM (${m})`;
}

const SIL_ODDS = ['unknown', '1 in 1,000', '1 in 100,000', '1 in 10 million'];

/** Accuracy (NACp) and integrity (NIC, SIL) of the position: lib/modes/integrity.ts. */
function uncertaintyFields(a: TrackedAircraft, now: number): Section['fields'] {
	const u = uncertainty(a);
	const fields: Section['fields'] = [];
	if (a.nacP)
		fields.push({
			label: 'Accuracy',
			value: u.accuracy === null ? 'unknown (NACp 0)' : `< ${radius(u.accuracy)} (NACp ${u.nacP})`,
			title: `The navigation system's estimate of its own error: the true position is within this distance 95 % of the time (NACp, 0–11). Satellite navigation gives NACp 8–10 (93 m down to 10 m); larger means inertial navigation (drifts about 1 NM an hour), radio beacons, or a disturbed receiver, e.g. jamming.${u.accuracy === null ? " Unknown: it can't say, usually without a satellite fix." : ''}${source(a.nacP, now)}`,
			tone: u.accuracy === null || u.accuracy > 0.3 * 1852 ? 'alert' : 'main'
		});
	const c = u.containment;
	if (c && a.positionCode) {
		const sil = u.sil;
		const per = u.silSupplement ? 'per position' : 'per hour';
		fields.push({
			label: 'Integrity',
			value:
				c.rc === null
					? 'unknown'
					: `< ${radius(c.rc)}${c.nic === null ? ' (HPL)' : ` (NIC ${c.nic})`}${sil ? `, SIL ${sil}` : ''}`,
			title: `The radius of containment: the position is guaranteed to be within it unless the navigation system fails unnoticed (SIL says how likely${sil ? `: ${SIL_ODDS[sil]} ${per}` : ''}). Air traffic control separates aircraft on this, not on the accuracy. Not sent as a number: the type code (TC ${a.positionCode.value.tc}) says it, ${
				c.nic === null
					? 'as the horizontal protection limit (ADS-B version 0 has no NIC).'
					: 'refined by the NIC supplement bits (TC 31 and the position message).'
			}${c.assumed ? ' A supplement bit is still missing, so this is the larger possible radius.' : ''}${source(a.positionCode, now)}`,
			tone: c.rc === null || c.rc > 1852 ? 'alert' : 'main'
		});
	}
	return fields;
}

/**
 * The database's entry: what the messages can't say (lib/aircraft-db.ts). The section's
 * title names the source; a tooltip only says more where the radio disagrees with it.
 */
function airframeFields(a: TrackedAircraft, db: DbAircraft): Section['fields'] {
	const fields: Section['fields'] = [];
	if (db.type || db.icaoType)
		fields.push({
			label: 'Type',
			value: [db.icaoType, `${db.manufacturer} ${db.type}`.trim()].filter(Boolean).join(' · '),
			title:
				"The ICAO type designator (Doc 8643), as flight plans and the controller's screen use it (A21N = Airbus A321neo, B738 = Boeing 737-800), then the manufacturer's model. ADS-B itself only says the weight class (the category).",
			tone: 'main'
		});
	if (db.registration) {
		const decoded = a.registration?.value;
		const block = allocation(a.icao);
		const register =
			db.country && !(block?.country && block.country === db.country.iso.toLowerCase())
				? ` It's on ${db.country.name}'s register, ${block ? `but the address is from ${block.state}'s block` : 'but the address is in no State’s block'}: an aircraft that changed registers keeps its address until the new State assigns one, and databases mix up owner and register countries.`
				: '';
		fields.push({
			label: 'Registration',
			value: db.registration,
			// Only where the radio disagrees: "Registered in" already gives the nationality mark.
			title:
				`${register}${
					decoded === undefined || decoded === db.registration
						? ''
						: ` A radar read ${decoded} from the transponder (register 2,1): one of the two is out of date.`
				}`.trim() || undefined,
			tone: decoded !== undefined && decoded !== db.registration ? 'alert' : 'main',
			mono: true
		});
	}
	if (db.owner) {
		const flying = a.callsign ? airlineDesignator(a.callsign.value) : null;
		const operator = !db.operator
			? ''
			: flying === null
				? ` In brackets: its usual operator's ICAO designator.`
				: flying === db.operator
					? ''
					: ` In brackets: its usual operator, but the callsign says ${flying}: it's flying for another airline today (a wet lease or charter), or it changed hands.`;
		fields.push({
			label: 'Owner',
			value: db.operator ? `${db.owner} (${db.operator})` : db.owner,
			title: `Who the aircraft is registered to: often not the airline, as leasing companies own about half of all airliners. The callsign says who flies it today.${operator}`,
			tone: 'main'
		});
	}
	return fields;
}

export function aircraftSections(
	a: TrackedAircraft,
	now: number,
	receiver: LatLon,
	unit: Unit,
	/** What adsbdb knows about the airframe (lib/aircraft-db.ts); null: nothing (yet). */
	db: DbAircraft | null = null,
	/** What adsbdb knows about the flight under its callsign; null: nothing (yet). */
	trip: DbFlight | null = null,
	/** The route check for it (tracker/route.ts RouteJudge); null: no route (yet). */
	judged: Judged | null = null,
	/** Every aircraft: for an ACAS advisory's threat. */
	all: TrackedAircraft[] = [],
	/**
	 * Its wind and temperature (lib/weather/tracker.ts), heading check, and the temperature
	 * layer at its level (lib/weather/profile.ts, for the contrail line); null: none.
	 */
	weather: {
		aircraft: WeatherAircraft;
		check: HeadingCheck | null;
		layer: Layer | null;
	} | null = null
): Section[] {
	const sections: Section[] = [];
	const add = (title: string, fields: Section['fields']) => {
		if (fields.length) sections.push({ title, fields });
	};

	// --- alerts, on top: what it means and what happens next -----------------------------
	for (const x of alertsOf(a, now)) sections.push(alertSection(x, a, all, now, unit));

	// --- identity ------------------------------------------------------------------------
	const identity: Section['fields'] = [];
	if (a.callsign)
		identity.push({
			label: 'Callsign',
			value: a.callsign.value,
			title: source(a.callsign, now).trim(),
			tone: 'main',
			mono: true
		});
	identity.push({
		label: 'Address',
		value: a.icao,
		title:
			"The transponder's 24-bit ICAO address, in hex. It belongs to the airframe, not the flight, and every Mode S message carries it: in the clear (DF11/17) or folded into the checksum (radar replies).",
		tone: 'main',
		mono: true
	});
	const block = allocation(a.icao);
	identity.push({
		label: 'Registered in',
		value: block?.state ?? 'no State’s block',
		flag: block ? { country: block.country, name: block.state } : undefined,
		title: block
			? `Each State gets a block of addresses (ICAO Annex 10, Vol. III, Table 9-1) for the aircraft on its register, so the address alone says it: this one is in ${block.from}–${block.to}.${block.marks.length ? ` Registrations there start with ${block.marks.join(' or ')}.` : ''} Not necessarily the airline's country: leased aircraft often keep a foreign registration.`
			: 'The address is in no State’s block (Annex 10, Vol. III, Table 9-1): ICAO hasn’t allocated it to anyone.',
		tone: 'minor'
	});
	if (a.registration)
		identity.push({
			label: 'Registration',
			value: a.registration.value,
			title:
				'The "tail number", read by a radar from the transponder\'s register 2,1, which few radars ask for. Sent without the dash (the 6-bit alphabet has none); it goes back after the nationality mark of the address\'s State.' +
				source(a.registration, now),
			tone: 'main',
			mono: true
		});
	if (a.category) {
		const { set, code, name } = a.category.value;
		identity.push({
			label: 'Category',
			value: `${set}${code} · ${name}`,
			title:
				`Emitter category (DO-260B Table A-2-8): the set from the type code (TC ${'DCBA'.indexOf(set) + 1} = set ${set}), the number from the message. For aircraft it's the weight class (maximum take-off weight), which sets how much wake turbulence it leaves and so how far behind it others must fly.` +
				source(a.category, now),
			// The set's categories, without the reserved codes nobody sends.
			choices: categoryNames(set).flatMap((text, i) =>
				text === 'Reserved' ? [] : [{ key: `${set}${i}`, text, current: i === code }]
			),
			tone: 'minor'
		});
	}
	if (a.squawk) {
		const special = SPECIAL_SQUAWKS[a.squawk.value];
		identity.push({
			label: 'Squawk',
			value: a.squawk.value,
			note: special?.meaning,
			title:
				'The Mode A code ATC assigns, four octal digits (0–7), so the radar can tell flights apart. A few have a fixed meaning: 7500 hijack, 7600 radio failure, 7700 emergency.' +
				(special?.detail ? ` ${a.squawk.value}: ${special.detail}.` : '') +
				source(a.squawk, now),
			tone: special?.emergency ? 'alert' : 'main',
			mono: true
		});
	}
	if (identing(a, now)) identity.push(identField());
	add('Identity', identity);
	const route = trip && routeSection(a, trip, judged, unit);
	if (route) sections.push(route);
	if (db) {
		const fields = airframeFields(a, db);
		if (fields.length) sections.push({ title: 'Airframe', source: 'adsbdb', fields });
	}

	// --- position ------------------------------------------------------------------------
	const position: Section['fields'] = [];
	const p = a.position;
	if (p) {
		const shown = shownPosition(a, now);
		position.push({
			label: 'Position',
			value: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
			title: `Latitude, longitude (WGS84). Compact Position Reporting only sends where the aircraft is within a grid zone; ${
				p.from === 'pair'
					? 'an even and an odd message together say which zone (global decoding)'
					: 'the zone came from its own position a moment earlier (local decoding)'
			}. It resolves about 5 m (1.25 m on the ground).${source({ value: null, t: p.t, from: p.surface ? 'TC 5–8' : 'TC 9–18' }, now)}`,
			tone: 'main',
			mono: true
		});
		const km = distanceKm(receiver, p);
		const b = bearing(receiver, p);
		position.push({
			label: 'From receiver',
			value: `${distanceText(km, unit)} ${compass(b)} (${deg(b)})`,
			tone: 'main'
		});
		position.push(...uncertaintyFields(a, now));
		if (!a.confirmed)
			position.push({
				label: 'Not on the map',
				value: 'unconfirmed',
				title:
					'A first position counts only once the next one agrees with it: one corrupted pair of messages could otherwise put the aircraft anywhere for a moment.',
				tone: 'alert'
			});
		else {
			// Always this one row, whatever the age: a row that comes and goes with every
			// position message makes the whole panel jump.
			const age = Math.max(0, now - p.t);
			const deadReckoning = `Positions come about twice a second, but some get lost. In between, the map moves it on with the ground speed and track (dead reckoning) for up to ${EXTRAPOLATE_MS / 1000} s, along the arc in a turn.`;
			position.push(
				!shown
					? {
							label: 'On the map',
							value: `hidden (no position for ${Math.round(age / 1000)} s)`,
							title: `After ${SHOW_MS / 1000} s without a position the map stops drawing it: probably out of range, behind a hill or below the radio horizon. It stays in the list while other messages come.`,
							tone: 'alert'
						}
					: shown.extrapolatedKm > 0 && shown.age >= 1000
						? {
								label: 'On the map',
								value: `moved on ${distanceText(shown.extrapolatedKm, unit)} (${Math.round(shown.age / 1000)} s)`,
								title: `The last position is ${(shown.age / 1000).toFixed(1)} s old. ${deadReckoning}`,
								tone: 'minor'
							}
						: {
								label: 'On the map',
								value: `at the last position (${Math.round(shown.age / 1000)} s)`,
								// Under a second old and moving: the healthy case, nothing to explain.
								title:
									shown.extrapolatedKm > 0
										? undefined
										: `Without a ground speed and track (on the ground, or no velocity message yet) the map leaves the symbol at the last position. ${deadReckoning}`,
								tone: 'minor'
							}
			);
		}
		if (a.rejected > 0)
			position.push({
				label: 'Rejected',
				value: `${a.rejected} position${a.rejected === 1 ? '' : 's'}`,
				title: `Positions that failed the plausibility checks: too far from the last one for the time between them, or more than ${MAX_RANGE_KM} km from the receiver, past any radio horizon. Last reason: ${a.lastRejection?.value ?? '–'}.`,
				tone: 'alert'
			});
	} else {
		position.push({
			label: 'Position',
			value: 'none',
			title: a.adsb
				? 'It sends ADS-B, but no position yet: its position messages say "no position information" (TC 0, e.g. no GPS fix), or too few got through (a position needs an even and an odd message within 10 s).'
				: "No ADS-B, only radar replies (altitude, squawk), which don't say where it is. A radar knows from its antenna's direction and the reply's delay; one receiver that only listens can't (several timing the same reply could: multilateration).",
			tone: 'alert'
		});
	}
	add('Position', position);

	// --- altitude and movement -----------------------------------------------------------
	const flight: Section['fields'] = [];
	if (p?.surface)
		flight.push({
			label: 'Altitude',
			value: 'on the ground',
			title:
				'It sends surface positions (TC 5–8): aircraft switch to those on the ground. They have no altitude, but a speed and a direction instead.',
			tone: 'main'
		});
	else if (a.altitude)
		flight.push({
			label: 'Altitude',
			value: `${flightLevel(a.altitude.value)} · ${n(a.altitude.value)} ft`,
			title:
				'Pressure altitude: where the standard atmosphere (1013.25 hPa at sea level) has the pressure measured outside. Every aircraft measures it the same way, so they stay separated whatever the weather. Below the transition altitude (5,000 ft in Germany) pilots fly by the local pressure (QNH); this value stays standard.' +
				source(a.altitude, now),
			tone: 'main'
		});
	if (a.gnssHeight)
		flight.push({
			label: 'GNSS height',
			value: `${n(a.gnssHeight.value)} ft`,
			title:
				'Height above the WGS84 ellipsoid from satellite navigation, sent instead of the barometric altitude (TC 20–22). Rare.' +
				source(a.gnssHeight, now),
			tone: 'main'
		});
	if (a.verticalRate && !p?.surface) {
		const r = a.verticalRate.value;
		flight.push({
			label: 'Vertical rate',
			value: Math.abs(r.rate) < 100 ? 'level' : `${signed(r.rate)} ft/min`,
			title: `From ${r.source === 'GNSS' ? 'satellite navigation' : 'the change in air pressure'}. Airliners climb at 1,000–3,000 ft/min and descend at 1,000–2,000; under 100 counts as level here (the message's step is 64).${source(a.verticalRate, now)}`,
			tone: 'main'
		});
	}
	if (a.ground && !p?.surface) {
		const g = a.ground.value;
		flight.push(
			{
				label: 'Ground speed',
				value: `${n(g.speed)} kt · ${n(g.speed * KM_PER_NM)} km/h`,
				title:
					'Speed over the ground, not through the air: a 100 kt tailwind in the jet stream adds 100 kt. Sent as east–west and north–south components.' +
					source(a.ground, now),
				tone: 'main'
			},
			{
				label: 'Track',
				value: `${deg(g.track)} ${compass(g.track)}`,
				title:
					'Where it moves over the ground, from true north. The nose (the heading) points a little off it in a crosswind: the drift angle.' +
					source(a.ground, now),
				tone: 'main'
			}
		);
	}
	// Always there with the ground speed: the turn rate drops out whenever too few tracks
	// came in, and a row that comes and goes makes the panel jump.
	if (a.ground && !p?.surface) {
		const turn = a.turnRate;
		const straight = turn !== null && Math.abs(turn.value) < TURNING;
		flight.push(
			turn === null
				? {
						label: 'Turn',
						value: 'not measured',
						title: `Measured from the ground tracks of the last ${TURN_WINDOW_MS / 1000} s, and too few of them got through.`,
						tone: 'minor'
					}
				: {
						label: 'Turn',
						value: straight
							? 'straight'
							: `${Math.abs(turn.value).toFixed(1)}°/s ${turn.value > 0 ? 'right' : 'left'}`,
						title: `How fast the track changes: a straight line fitted through the last ${TURN_WINDOW_MS / 1000} s of tracks, so it lags a few seconds. Under ${TURNING}°/s counts as straight. A "standard rate" turn is 3°/s (a circle in two minutes); airliners at cruise turn at about 0.5–1°/s.${source(turn, now)}`,
						tone: straight ? 'minor' : 'main'
					}
		);
	}
	if (a.air && !p?.surface) {
		const { heading, speed, type } = a.air.value;
		// Said once: on the heading, or on the airspeed without one.
		const why =
			" It sends heading and airspeed instead of track and ground speed (TC 19 subtype 3/4): it can't measure those, which usually means no satellite fix (jamming, or a fault).";
		if (heading !== null) {
			const ref = headingReference(a);
			const at = p ?? receiver;
			const asTrue = trueHeading(heading, ref, at, a.air.t);
			flight.push({
				label: 'Heading',
				value:
					ref === 'magnetic' && at
						? `${deg(heading)} magnetic (${deg(asTrue)} true)`
						: `${deg(heading)}${ref ? ` ${ref}` : ''}`,
				title: `Where the nose points. ${
					ref === null
						? 'True or magnetic: its operational status (TC 31) will say.'
						: ref === 'magnetic'
							? 'From magnetic north (its operational status says so; before ADS-B version 2 it is taken as magnetic); true from the World Magnetic Model.'
							: 'From true north (its operational status, TC 31, says so).'
				}${why}${source(a.air, now)}`,
				tone: 'main'
			});
		}
		if (speed !== null)
			flight.push({
				label: 'Airspeed',
				value: `${n(speed)} kt ${type}`,
				title: `${
					type === 'IAS'
						? 'Indicated airspeed: what the pitot tube measures. Up high the air is thin, so it reads far below the true airspeed: 250 kt IAS is about 460 kt true at FL380.'
						: 'True airspeed: the speed through the air.'
				}${heading === null ? why : ''}${source(a.air, now)}`,
				tone: 'main'
			});
	}
	const m = motion(a);
	if (m && a.confirmed) {
		const sideways =
			m.turnRate === 0 || m.turnLeft === 0
				? 'straight on'
				: m.rollOut !== null
					? `turning ${m.turnRate > 0 ? 'right' : 'left'} to ${deg(m.rollOut)}`
					: `turning ${m.turnRate > 0 ? 'right' : 'left'}, end unknown`;
		const vertical =
			m.verticalRate === 0
				? 'level'
				: `${m.verticalRate > 0 ? 'climbing' : 'descending'}${m.levelOff !== null ? ` to ${flightLevel(m.levelOff)}` : ''}`;
		flight.push({
			label: 'Predicted',
			value: `${sideways}, ${vertical}`,
			tone: 'minor'
		});
	} else if (p && !p.surface && a.confirmed) {
		flight.push({
			label: 'Predicted',
			value: 'no',
			title: a.air
				? "It sends heading and airspeed, not track and ground speed, and without the wind those don't say where it goes."
				: 'That needs a ground speed and track (TC 19) from within 10 s of the position, and none got through.',
			tone: 'minor'
		});
	}
	if (a.surface && p?.surface) {
		const { movement, direction } = a.surface.value;
		const speed = movement.speed;
		flight.push({
			label: 'Movement',
			value: movement.stopped
				? 'stopped'
				: speed
					? `${speed.min}–${speed.max ?? '…'} kt${direction === null ? '' : `, ${deg(direction)}`}`
					: 'unknown',
			title:
				'On the ground the speed is a step on a non-linear scale: from 1/8 kt steps when barely moving to 5 kt steps above 100 kt. The direction is the ground track or the heading; the operational status says which.' +
				source(a.surface, now),
			tone: 'main'
		});
	}
	add('Flight', flight);

	// --- intent --------------------------------------------------------------------------
	const intent: Section['fields'] = [];
	const target = a.target?.value;
	if (target?.selectedAltitude)
		intent.push({
			label: 'Selected altitude',
			value: `${flightLevel(target.selectedAltitude.feet)} (${target.selectedAltitude.source})`,
			title:
				'Where the autopilot will level off: dialled in by the pilots (MCP on Boeings, FCU on Airbus) or planned by the flight management system (FMS).' +
				source(a.target!, now),
			tone: 'main'
		});
	if (target?.selectedHeading !== null && target?.selectedHeading !== undefined)
		intent.push({
			label: 'Selected heading',
			value: deg(target.selectedHeading),
			title:
				"Only flown in heading mode; in LNAV the flight management system steers along the route, and this is just what's dialled in." +
				source(a.target!, now),
			tone: 'main'
		});
	if (target?.modes) {
		const m = target.modes;
		const on = [
			m.autopilot && 'autopilot',
			m.lnav && 'LNAV',
			m.vnav && 'VNAV',
			m.altitudeHold && 'altitude hold',
			m.approach && 'approach'
		].filter(Boolean);
		intent.push({
			label: 'Modes',
			value: on.length ? on.join(' · ') : 'hand-flown',
			title:
				"LNAV: following the flight management system's route. VNAV: its planned climbs and descents. Altitude hold: keeping the current altitude. Approach: following a landing guidance signal (ILS)." +
				source(a.target!, now),
			tone: 'main'
		});
	}
	if (target?.qnh)
		intent.push({
			label: 'Altimeter',
			value: `${target.qnh.toFixed(1)} hPa${Math.abs(target.qnh - 1013.2) < 0.5 ? ' (standard)' : ''}`,
			title:
				"The altimeter's setting: 1013.25 hPa at flight levels, else the local QNH (the airport's pressure reduced to sea level). Sent in 0.8 hPa steps, so standard comes out as 1013.6." +
				source(a.target!, now),
			tone: 'minor'
		});
	add('Autopilot', intent);

	// --- weather, from its Comm-B registers ----------------------------------------------
	if (weather) {
		const contrail = contrailField(weather.aircraft, weather.layer);
		add('Weather where it flies', [
			...weatherHereFields(weather.aircraft, weather.check, now),
			...(contrail ? [contrail] : [])
		]);
	}

	// --- Comm-B --------------------------------------------------------------------------
	const radar: Section['fields'] = [];
	const hs = a.commB.headingAndSpeed;
	const tt = a.commB.trackAndTurn;
	if (hs?.value.heading !== null && hs?.value.heading !== undefined)
		radar.push({
			label: 'Heading',
			value: `${deg(hs.value.heading)} magnetic`,
			title: 'Where the nose points, from magnetic north.' + source(hs, now),
			tone: 'main'
		});
	if (hs && (hs.value.ias !== null || hs.value.mach !== null))
		radar.push({
			label: 'Airspeed',
			value: [
				hs.value.ias !== null && `${n(hs.value.ias)} kt IAS`,
				hs.value.mach !== null && `Mach ${hs.value.mach.toFixed(3)}`
			]
				.filter(Boolean)
				.join(' · '),
			title:
				'IAS: what the pitot tube measures and the wings fly by; up high it reads far below the true airspeed. Mach: the speed as a fraction of the speed of sound there; airliners cruise at Mach 0.78–0.85.' +
				source(hs, now),
			tone: 'main'
		});
	if (tt?.value.tas !== null && tt?.value.tas !== undefined)
		radar.push({
			label: 'True airspeed',
			value: `${n(tt.value.tas)} kt`,
			title: 'Speed through the air: the ground speed minus the tailwind.' + source(tt, now),
			tone: 'main'
		});
	if (tt?.value.roll !== null && tt?.value.roll !== undefined)
		radar.push({
			label: 'Bank',
			value:
				Math.abs(tt.value.roll) < 1
					? 'wings level'
					: `${Math.abs(tt.value.roll).toFixed(1)}° ${tt.value.roll > 0 ? 'right' : 'left'}`,
			title:
				'Roll angle: an aircraft turns by banking; airliners use up to 25–30°.' + source(tt, now),
			tone: 'main'
		});
	add('From radar interrogations (Comm-B)', radar);

	// --- reception -----------------------------------------------------------------------
	const reception: Section['fields'] = [
		{
			label: 'Messages',
			value: `${n(a.messages)} in ${ago(now - a.firstSeen).replace(' ago', '')}`,
			tone: 'minor'
		},
		{
			label: 'Last heard',
			value: ago(now - a.lastSeen),
			tone: 'minor'
		}
	];
	if (a.signal !== null)
		reception.push({
			label: 'Signal',
			value: `${a.signal.toFixed(1)} dBFS`,
			title:
				"The latest message's strength, in dB below the receiver's full scale (−6 dB: half the amplitude). Nearer is louder, but transmitters differ in power, and buildings or hills dim what's behind them.",
			tone: 'minor'
		});
	add('Reception', reception);
	return sections;
}
