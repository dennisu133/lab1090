/**
 * The tracker's detail panel: everything known about one aircraft, in sections, each value
 * with an explanation of what it is and what it means, and where it came from. The tracker
 * works on phones too, so the panel shows these explanations as tappable InfoTips, not as
 * hover titles: every field here has a `label`.
 *
 * The tracker is the first page people see, so the explanations are short and casual, and
 * leave the details to the page that has them, with a link (`[text](/weather)`). Message
 * types (type codes, downlink formats) only appear in the `footnote` (`origin()`), linked to /frames,
 * which explains them.
 */
import { bearing, compass, distanceKm } from '#lib/geo.ts';
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
import { EXTRAPOLATE_MS, SHOW_MS, shownPosition } from '#lib/tracker/shown.ts';
import { KM_PER_NM, NM } from '#lib/units.ts';
import { alertSection, identField } from './alert';
import { contrailField } from './contrail';
import { formatLink, registerLink, typeCodeLink, type Field } from './field';
import {
	ago,
	dbfs,
	directionText,
	distanceText,
	flightLevel,
	n,
	signed,
	type Unit
} from './format';
import { routeSection } from './route';
import { weatherHereFields } from './weather';

/** A row in the panel. */
export type PanelField = Omit<Field, 'title'> & {
	label: string;
	/**
	 * The explanation; none for values that explain themselves (Route, Messages, …). A blank
	 * line starts a paragraph; `[text](/frames)` or `[text](https://…)` is a link.
	 */
	title?: string;
	/**
	 * A dimmed line under the explanation: which message it came from and how long ago
	 * (`origin()`), or the fine print (the route check's limits).
	 */
	footnote?: string;
	/** A few plain words after the value, dimmed: what a code stands for ("1000 · conspicuity code"). */
	note?: string;
	/** Every possible value, the one sent marked: a table under the explanation. */
	choices?: { key: string; text: string; current: boolean }[];
	/** A flag before the value: ISO 3166-1 alpha-2 code and the State's name. */
	flag?: { country: string | null; name: string };
};

export interface Section {
	title: string;
	/** Where the values come from when we didn't decode them ourselves: "adsbdb". */
	source?: string;
	fields: PanelField[];
	/** An alert's section: its colour. */
	tier?: Tier;
}

/**
 * Where a value came from, for the line under its explanation: the message type, linked to
 * /frames (or /comm-b), where the types are explained.
 */
export function origin<T>(v: Timed<T>, now: number): string {
	const p = v.from;
	const when = ago(now - v.t);
	switch (p.kind) {
		case 'adsb':
			return `From an ADS-B message (${typeCodeLink(p.tc, p.to)}), ${when}.`;
		case 'reply':
			return `From a reply to a radar (${formatLink(p.df)}), ${when}.`;
		case 'comm-b':
			return `Read out by a radar (${registerLink(p.bds)}), ${when}.`;
		case 'position check':
			return `From the position checks, ${when}.`;
	}
}

/** "30 m", "0.3 NM (556 m)": metres up to 100, then nautical miles as well. */
function radius(metres: number): string {
	if (metres < 100) return `${n(metres)} m`;
	const nm = metres / NM;
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
			title: `How far off the position may be, by the navigation system's own estimate: the real position is within this distance 95 % of the time. Sent as the navigation accuracy category (NACp), 0–11.\n\nWith satellite navigation it's 3–93 m. More means the aircraft navigates without it (inertial navigation drifts with time, radio beacons are coarser) or its satellite receiver is disturbed, e.g. by jamming.${u.accuracy === null ? " Unknown: it can't say, usually because it has no satellite fix." : ''}`,
			footnote: origin(a.nacP, now),
			tone: u.accuracy === null || u.accuracy > 0.3 * NM ? 'alert' : 'main'
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
			title: `A limit rather than an estimate: the position stays within this radius unless the navigation system fails without noticing. Sent as the navigation integrity category (NIC)${
				c.nic === null
					? '; older transponders (ADS-B version 0) send the horizontal protection limit (HPL) instead'
					: ''
			}.${sil ? ` How likely such a failure is: the source integrity level (SIL), here ${SIL_ODDS[sil]} ${per}.` : ''}${c.assumed ? ' A bit that narrows it down hasn’t come in yet, so this is the larger of the possible radii.' : ''}\n\nTo fly where ADS-B is required, US rules ask for at least NIC 7 (0.2 NM) and NACp 8 (93 m) ([14 CFR 91.227](https://www.ecfr.gov/current/title-14/part-91/section-91.227)).`,
			footnote: origin(a.positionCode, now),
			tone: c.rc === null || c.rc > NM ? 'alert' : 'main'
		});
	}
	return fields;
}

/** The lookup failed: say what's missing, not just leave the section out. */
function unreachableField(): PanelField {
	return {
		label: 'Database',
		value: 'not reachable',
		title:
			'This device couldn’t reach adsbdb (api.adsbdb.com), the online database of aircraft and routes: no type, registration, owner, photo or route. Everything else here comes from the aircraft’s own messages, which need no internet. It’s asked again the next time the aircraft is selected.',
		tone: 'minor'
	};
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
				'The type designator, the short code for the model in flight plans (A21N: Airbus A321neo, B738: Boeing 737-800; ICAO Doc 8643), then the maker’s name for it. The aircraft’s own messages only say its weight class (Category).',
			tone: 'main'
		});
	if (db.registration) {
		const decoded = a.registration?.value;
		const block = allocation(a.icao);
		const register =
			db.country && !(block?.country && block.country === db.country.iso.toLowerCase())
				? `It’s on ${db.country.name}’s register, ${block ? `but the address is from ${block.state}’s block` : 'but the address is in no country’s block'}: an aircraft that moves to another register keeps its address until the new country assigns one, and databases sometimes mix up the owner’s country and the register’s.`
				: '';
		fields.push({
			label: 'Registration',
			value: db.registration,
			// Only where the radio disagrees: "Registered in" already gives the nationality mark.
			title:
				`${register}${
					decoded === undefined || decoded === db.registration
						? ''
						: ` A radar read ${decoded} from the transponder itself: one of the two is out of date.`
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
				? ' In brackets: the airline that usually flies it.'
				: flying === db.operator
					? ''
					: ` In brackets: the airline that usually flies it, but the callsign says ${flying}: today it flies for another airline (hired with its crew, or chartered), or it changed hands.`;
		fields.push({
			label: 'Owner',
			value: db.operator ? `${db.owner} (${db.operator})` : db.owner,
			title: `Who the aircraft is registered to: often a leasing company rather than the airline. The callsign says who flies it today.${operator}`,
			tone: 'main'
		});
	}
	return fields;
}

/** Who it is: callsign, address, the State whose block the address is in, category, squawk. */
function identityFields(a: TrackedAircraft, now: number): PanelField[] {
	const identity: Section['fields'] = [];
	if (a.callsign)
		identity.push({
			label: 'Callsign',
			value: a.callsign.value,
			title: "The flight's name on the radio and on the controllers' screens, set by the crew.",
			footnote: origin(a.callsign, now),
			tone: 'main',
			mono: true
		});
	identity.push({
		label: 'Address',
		value: a.icao,
		title:
			"The transponder's ICAO address: a number of 24 bits, written as six hexadecimal digits (0–9 and A–F). It belongs to the aircraft, not the flight, and every message the transponder sends carries it (ICAO Annex 10, Vol. III, Chapter 9).",
		tone: 'main',
		mono: true
	});
	const block = allocation(a.icao);
	identity.push({
		label: 'Registered in',
		value: block?.state ?? 'no country’s block',
		flag: block ? { country: block.country, name: block.state } : undefined,
		title: block
			? `ICAO gives every country a block of addresses for the aircraft on its register, so the address alone says where an aircraft is registered (ICAO Annex 10, Vol. III, Chapter 9). ${block.state}'s block runs from ${block.from} to ${block.to}${block.marks.length ? `, and its registrations start with ${block.marks.join(' or ')}` : ''}.\n\nThat isn't always the airline's country: airlines also fly aircraft registered abroad, leased or with a daughter company there.`
			: 'The address is in no country’s block: ICAO hasn’t given it to anyone (ICAO Annex 10, Vol. III, Chapter 9).',
		tone: 'minor'
	});
	if (a.registration)
		identity.push({
			label: 'Registration',
			value: a.registration.value,
			title:
				'The registration ("tail number") painted on the aircraft, stored in the transponder as well, where a radar read it. Few radars ask for it. It comes without the dash, which goes back after the country’s prefix.',
			footnote: origin(a.registration, now),
			tone: 'main',
			mono: true
		});
	if (a.category) {
		const { set, code, name } = a.category.value;
		identity.push({
			label: 'Category',
			value: `${set}${code} · ${name}`,
			title:
				"What kind of aircraft it is, set when the transponder is installed, from this list (ICAO Doc 9871, Table A-2-8). For most aeroplanes it's a weight class, by the most the aircraft may weigh at take-off: heavier aircraft leave stronger wake turbulence behind them.",
			footnote: origin(a.category, now),
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
				'The four-digit code air traffic control (ATC) gives a flight, so controllers can tell the flights on their radar screens apart. Also called the Mode A code, after the oldest radar question it answers. Only the digits 0–7 are used. Three codes have a fixed meaning everywhere: 7500 hijack, 7600 radio failure, 7700 emergency (ICAO Doc 8168, Vol. III).' +
				(special?.detail ? `\n\n${a.squawk.value}: ${special.detail}.` : ''),
			footnote: origin(a.squawk, now),
			tone: special?.emergency ? 'alert' : 'main',
			mono: true
		});
	}
	if (identing(a, now)) identity.push(identField());
	return identity;
}

/** Where it is, how sure that is, and what the map makes of it. */
function positionFields(
	a: TrackedAircraft,
	now: number,
	receiver: LatLon,
	unit: Unit
): PanelField[] {
	const p = a.position;
	const position: Section['fields'] = [];
	if (p) {
		const shown = shownPosition(a, now);
		position.push({
			label: 'Position',
			value: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
			title: `Latitude and longitude, sent to the nearest ${p.surface ? '1.25' : '5'} m (how accurate that is: Accuracy). To save bits, ADS-B sends positions in Compact Position Reporting (CPR): each message only says where the aircraft is within a cell of a grid laid over the Earth, about ${p.surface ? '170' : '670'} km across. ${
				p.from === 'pair'
					? 'Two messages on two slightly different grids ("even" and "odd") together say which cell.'
					: 'Which cell came from its own position a moment earlier.'
			} (ICAO Doc 9871, C.2.6)`,
			footnote: origin(
				{
					value: null,
					t: p.t,
					from: p.surface ? { kind: 'adsb', tc: 5, to: 8 } : { kind: 'adsb', tc: 9, to: 18 }
				},
				now
			),
			tone: 'main',
			mono: true
		});
		const km = distanceKm(receiver, p);
		const b = bearing(receiver, p);
		position.push({
			label: 'From receiver',
			value: `${distanceText(km, unit)} ${compass(b)} (${directionText(b)})`,
			tone: 'main'
		});
		position.push(...uncertaintyFields(a, now));
		if (!a.confirmed)
			position.push({
				label: 'Not on the map',
				value: 'unconfirmed',
				title:
					'A first position only counts once the next one agrees with it: one corrupted message could otherwise put the aircraft anywhere for a moment.',
				tone: 'alert'
			});
		else {
			// Always this one row, whatever the age: a row that comes and goes with every
			// position message makes the whole panel jump. Its tooltip likewise depends only on
			// whether the aircraft can be moved on (a ground velocity), not on the position's
			// age: tied to the age, it came and went with every position message.
			const age = Math.max(0, now - p.t);
			const deadReckoning = `Aircraft send their position about twice a second, but not every message gets through. In between, the map moves the aircraft on at its last speed and direction (dead reckoning), for up to ${EXTRAPOLATE_MS / 1000} s, along a curve if it's turning.`;
			const moving = motion(a) != null;
			position.push(
				!shown
					? {
							label: 'On the map',
							value: `hidden (no position for ${Math.round(age / 1000)} s)`,
							title: `After ${SHOW_MS / 1000} s without a position the map stops drawing it: it's probably out of range, behind a hill, or below the horizon as seen from the antenna.`,
							tone: 'alert'
						}
					: shown.extrapolatedKm > 0 && shown.age >= 1000
						? {
								label: 'On the map',
								value: `moved on ${distanceText(shown.extrapolatedKm, unit)} (${Math.round(shown.age / 1000)} s)`,
								title: deadReckoning,
								tone: 'minor'
							}
						: {
								label: 'On the map',
								value: `at the last position (${Math.round(shown.age / 1000)} s)`,
								title: moving
									? deadReckoning
									: `Without a ground speed and direction (on the ground, or none received yet) the map leaves the symbol at the last position. ${deadReckoning}`,
								tone: 'minor'
							}
			);
		}
		if (a.rejected > 0)
			position.push({
				label: 'Rejected',
				value: `${a.rejected} position${a.rejected === 1 ? '' : 's'}`,
				title: `Positions that failed the checks for plausibility: too far from the one before for the time in between, or more than ${MAX_RANGE_KM} km from the receiver, beyond what an antenna on the ground can hear. Last reason: ${a.lastRejection?.value ?? '–'}.`,
				tone: 'alert'
			});
	} else {
		position.push({
			label: 'Position',
			value: 'none',
			title: a.adsb
				? a.rejected > 0
					? `It sends positions, but all ${a.rejected} so far failed the checks for plausibility: too far from the one before for the time in between, or more than ${MAX_RANGE_KM} km from the receiver. Last reason: ${a.lastRejection?.value ?? '–'}.`
					: 'It sends ADS-B, but no position yet. Usually too few messages get through: a position takes two particular ones within 10 s. Sometimes the aircraft itself has none to send, e.g. without a satellite fix.'
				: "It sends no ADS-B, only replies to radars (altitude, squawk), and those don't say where it is. A radar knows from the direction its antenna points and how long the reply takes; a single receiver that only listens can't tell.",
			tone: 'alert'
		});
	}
	return position;
}

/** Altitude and movement: vertical rate, ground vector, turn, air data, the prediction. */
function flightFields(a: TrackedAircraft, now: number, receiver: LatLon): PanelField[] {
	const p = a.position;
	const flight: Section['fields'] = [];
	if (p?.surface)
		flight.push({
			label: 'Altitude',
			value: 'on the ground',
			title:
				'On the ground aircraft send surface positions: with speed and direction, but no altitude.',
			footnote: origin({ value: null, t: p.t, from: { kind: 'adsb', tc: 5, to: 8 } }, now),
			tone: 'main'
		});
	else if (a.altitude)
		flight.push({
			label: 'Altitude',
			value: `${flightLevel(a.altitude.value)} · ${n(a.altitude.value)} ft`,
			title:
				"Pressure altitude: the height at which the standard atmosphere (1013.25 hPa at sea level) has the air pressure measured outside. Every aircraft measures it the same way, so they stay apart whatever the weather. Low down, near airports, pilots set their altimeters to the local pressure instead (QNH); this value doesn't change with that.\n\nFL: flight level, the pressure altitude in hundreds of feet.",
			footnote: origin(a.altitude, now),
			tone: 'main'
		});
	if (a.gnssHeight)
		flight.push({
			label: 'GNSS height',
			value: `${n(a.gnssHeight.value)} ft`,
			title:
				'Height from satellite navigation (GNSS: GPS, Galileo and the like), sent instead of the pressure altitude, which is rare. Above the ellipsoid, the smooth shape satellite navigation takes the Earth to be, or above sea level where the receiver can’t give that (ICAO Doc 9871).',
			footnote: origin(a.gnssHeight, now),
			tone: 'main'
		});
	if (a.verticalRate && !p?.surface) {
		const r = a.verticalRate.value;
		flight.push({
			label: 'Vertical rate',
			value: Math.abs(r.rate) < 100 ? 'level' : `${signed(r.rate, 0)} ft/min`,
			title: `How fast it climbs or descends, measured by ${r.source === 'gnss' ? 'satellite navigation' : 'the change in air pressure'}. It's sent in steps of 64 ft/min, so under 100 counts as level here. Airliners climb at about 1,000–3,000 ft/min ([Eurocontrol](https://learningzone.eurocontrol.int/ilp/customs/ATCPFDB/)).`,
			footnote: origin(a.verticalRate, now),
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
					'Speed over the ground, not through the air: a tailwind of 100 kt adds 100 kt. Knots (kt) are nautical miles per hour.',
				footnote: origin(a.ground, now),
				tone: 'main'
			},
			{
				label: 'Track',
				value: `${directionText(g.track)} ${compass(g.track)}`,
				title:
					'The direction it moves over the ground, clockwise from true north. In a crosswind the nose points a little off it, into the wind.',
				footnote: origin(a.ground, now),
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
						title: `Measured from its direction over the last ${TURN_WINDOW_MS / 1000} s, and too few messages with it got through.`,
						tone: 'minor'
					}
				: {
						label: 'Turn',
						value: straight
							? 'straight'
							: `${Math.abs(turn.value).toFixed(1)}°/s ${turn.value > 0 ? 'right' : 'left'}`,
						title: `How fast its direction changes, measured over the last ${TURN_WINDOW_MS / 1000} s, so it lags a few seconds behind. Under ${TURNING}°/s counts as straight. A "standard rate" turn is 3°/s, a full circle in two minutes (ICAO Doc 8168); airliners at cruising speed turn more gently, at about 1°/s.`,
						footnote: origin(turn, now),
						tone: straight ? 'minor' : 'main'
					}
		);
	}
	if (a.air && !p?.surface) {
		const { heading, speed, type } = a.air.value;
		// Said once: on the heading, or on the airspeed without one.
		const why =
			"\n\nIt sends its heading and airspeed instead of its track and ground speed: it can't measure those, which usually means it has no satellite fix (jamming, or a fault).";
		if (heading !== null) {
			const ref = headingReference(a);
			const at = p ?? receiver;
			const asTrue = trueHeading(heading, ref, at, a.air.t);
			flight.push({
				label: 'Heading',
				value:
					ref === 'magnetic'
						? `${directionText(heading)} magnetic (${directionText(asTrue)} true)`
						: `${directionText(heading)}${ref ? ` ${ref}` : ''}`,
				title: `Where the nose points, ${
					ref === null
						? 'from true or magnetic north: its status message will say which.'
						: ref === 'magnetic'
							? `from magnetic north (${a.operational?.value.version === 0 ? 'older transponders don’t say which, so magnetic is assumed' : 'as its status message says'}). Turned into true north with the [World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model).`
							: 'from true north (as its status message says).'
				}${why}`,
				footnote: origin(a.air, now),
				tone: 'main'
			});
		}
		if (speed !== null)
			flight.push({
				label: 'Airspeed',
				value: `${n(speed)} kt ${type}`,
				title: `${
					type === 'IAS'
						? 'Indicated airspeed (IAS): what the airspeed sensor at the front measures. Up high the air is thin, so it reads far below the real speed through the air: 250 kt indicated is about 450 kt at FL380.'
						: 'True airspeed (TAS): the speed through the air.'
				}${heading === null ? why : ''}`,
				footnote: origin(a.air, now),
				tone: 'main'
			});
	}
	const m = motion(a);
	if (m && a.confirmed) {
		const sideways =
			m.turnRate === 0 || m.turnLeft === 0
				? 'straight on'
				: m.rollOut !== null
					? `turning ${m.turnRate > 0 ? 'right' : 'left'} to ${directionText(m.rollOut)}`
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
				? "It sends heading and airspeed, not its track and ground speed, and without the wind those don't say where it goes."
				: 'That takes its ground speed and direction from within 10 s of the position, and none got through.',
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
					? `${speed.min}–${speed.max ?? '…'} kt${direction === null ? '' : `, ${directionText(direction)}`}`
					: 'unknown',
			title:
				'On the ground the speed comes in steps that grow with it: an eighth of a knot when barely moving, 5 kt above 100 kt. The direction is where it moves or where the nose points; its status message says which.',
			footnote: origin(a.surface, now),
			tone: 'main'
		});
	}
	return flight;
}

/** What the autopilot is set to (TC 29 target state and status). */
function autopilotFields(a: TrackedAircraft, now: number): PanelField[] {
	const intent: Section['fields'] = [];
	const target = a.target?.value;
	if (target?.selectedAltitude)
		intent.push({
			label: 'Selected altitude',
			value: `${flightLevel(target.selectedAltitude.feet)} (${target.selectedAltitude.source})`,
			title:
				'Where the autopilot will level off. MCP/FCU: dialled in by the pilots on the autopilot panel (Boeing calls it the MCP, Airbus the FCU). FMS: planned by the flight management system, the computer that flies the route.',
			footnote: origin(a.target!, now),
			tone: 'main'
		});
	if (target?.selectedHeading !== null && target?.selectedHeading !== undefined)
		intent.push({
			label: 'Selected heading',
			value: directionText(target.selectedHeading),
			title:
				'The heading set on the autopilot. Flown only when the autopilot steers by heading; when it follows the route (LNAV) this is just what happens to be dialled in.',
			footnote: origin(a.target!, now),
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
				'What the autopilot is doing. LNAV (lateral navigation): following the route in the flight management system. VNAV (vertical navigation): its planned climbs and descents. Altitude hold: keeping the current altitude. Approach: following the instrument landing system (ILS) down to a runway.',
			footnote: origin(a.target!, now),
			tone: 'main'
		});
	}
	if (target?.qnh)
		intent.push({
			label: 'Altimeter',
			value: `${target.qnh.toFixed(1)} hPa${Math.abs(target.qnh - 1013.2) < 0.5 ? ' (standard)' : ''}`,
			title:
				'What the altimeter is set to: the standard 1013.25 hPa at flight levels, else the local QNH (the air pressure at the airport, worked back to sea level). Sent in steps of 0.8 hPa, so the standard setting shows as 1012.8 or 1013.6.',
			footnote: origin(a.target!, now),
			tone: 'minor'
		});
	return intent;
}

/** Air data radars read from its Comm-B registers 5,0 (track and turn) and 6,0 (heading and speed). */
function commBFields(a: TrackedAircraft, now: number): PanelField[] {
	const radar: Section['fields'] = [];
	const hs = a.commB.headingAndSpeed;
	const tt = a.commB.trackAndTurn;
	if (hs?.value.heading !== null && hs?.value.heading !== undefined)
		radar.push({
			label: 'Heading',
			value: `${directionText(hs.value.heading)} magnetic`,
			title: 'Where the nose points, clockwise from magnetic north.',
			footnote: origin(hs, now),
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
				'Indicated airspeed (IAS): what the airspeed sensor measures, and what the wings fly by. Up high, in thin air, it reads far below the real speed through the air. Mach: the speed as a fraction of the speed of sound there; airliners cruise at about Mach 0.78–0.85.',
			footnote: origin(hs, now),
			tone: 'main'
		});
	if (tt?.value.tas !== null && tt?.value.tas !== undefined)
		radar.push({
			label: 'True airspeed',
			value: `${n(tt.value.tas)} kt`,
			title: 'The real speed through the air (TAS): the ground speed minus the tailwind.',
			footnote: origin(tt, now),
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
				'How far it leans into a turn (the roll angle): an aircraft turns by banking. Airliners rarely bank more than 25–30°: procedures around airports are designed for at most 25° (ICAO Doc 8168).',
			footnote: origin(tt, now),
			tone: 'main'
		});
	return radar;
}

/** How much of it we hear, and how loud. */
function receptionFields(a: TrackedAircraft, now: number): PanelField[] {
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
			value: dbfs(a.signal),
			title:
				'How strong its latest message was, in decibels below the strongest signal the receiver can take (dBFS; −6 dB is half the amplitude). Nearer is louder, but transmitters differ in power, and buildings or hills dim what’s behind them. More on [Receiver](/receiver).',
			tone: 'minor'
		});
	return reception;
}

export function aircraftSections(
	a: TrackedAircraft,
	now: number,
	receiver: LatLon,
	unit: Unit,
	/**
	 * What adsbdb knows about the airframe (lib/aircraft-db.ts); null: nothing (yet);
	 * 'unreachable': the lookup failed (offline, or adsbdb down).
	 */
	db: DbAircraft | null | 'unreachable' = null,
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

	// Alerts on top: what it means and what happens next.
	for (const x of alertsOf(a, now)) sections.push(alertSection(x, a, all, now, unit));
	add('Identity', identityFields(a, now));
	const route = trip && routeSection(a, trip, judged, unit);
	if (route) sections.push(route);
	if (db === 'unreachable') {
		sections.push({ title: 'Airframe', source: 'adsbdb', fields: [unreachableField()] });
	} else if (db) {
		const fields = airframeFields(a, db);
		if (fields.length) sections.push({ title: 'Airframe', source: 'adsbdb', fields });
	}
	add('Position', positionFields(a, now, receiver, unit));
	add('Flight', flightFields(a, now, receiver));
	add('Autopilot', autopilotFields(a, now));
	if (weather) {
		const contrail = contrailField(weather.aircraft, weather.layer);
		add('Weather where it flies', [
			...weatherHereFields(weather.aircraft, weather.check, now),
			...(contrail ? [contrail] : [])
		]);
	}
	add('Read out by radars (Comm-B)', commBFields(a, now));
	add('Reception', receptionFields(a, now));
	return sections;
}
