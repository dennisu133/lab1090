/**
 * The tracker's detail panel: everything known about one aircraft, in sections, each value
 * with an explanation of what it is, where it came from and what it means. The tracker
 * works on phones too, so the panel shows these explanations as tappable InfoTips, not as
 * hover titles: every field here has a `label`.
 */
import { bearing, compass, distanceKm, KM_PER_NM } from '#lib/geo.ts';
import type { Timed } from '#lib/modes/adsb-memory.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { allocation } from '#lib/modes/nationality.ts';
import { SPECIAL_SQUAWKS } from '#lib/modes/squawk.ts';
import {
	headingReference,
	MAX_OPEN_TURN,
	motion,
	TURNING,
	trueHeading
} from '#lib/tracker/motion.ts';
import { TURN_WINDOW_MS, type TrackedAircraft } from '#lib/tracker/tracker.ts';
import {
	flightLevel,
	PREDICT_S,
	PREDICT_SELECTED_S,
	shownPosition,
	type Unit
} from '#lib/map/features.ts';
import type { Field } from './frame';

export interface Section {
	title: string;
	fields: (Field & { label: string })[];
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

export function aircraftSections(
	a: TrackedAircraft,
	now: number,
	receiver: LatLon | null,
	unit: Unit
): Section[] {
	const sections: Section[] = [];
	const add = (title: string, fields: Section['fields']) => {
		if (fields.length) sections.push({ title, fields });
	};

	// --- identity ------------------------------------------------------------------------
	const identity: Section['fields'] = [];
	if (a.callsign)
		identity.push({
			label: 'Callsign',
			value: a.callsign.value,
			title:
				'The name the flight goes by on the radio and on the radar screen. For airlines the ICAO code of the airline plus a flight number (DLH = Lufthansa, BEL = Brussels Airlines, RYR = Ryanair); for private flights often the registration.' +
				source(a.callsign, now),
			tone: 'main',
			mono: true
		});
	identity.push({
		label: 'Address',
		value: a.icao,
		title:
			"The transponder's 24-bit ICAO address, in hex. It belongs to the airframe, not the flight: it's assigned with the registration, and every Mode S message carries it, in the clear (DF11/17) or hidden in the checksum (radar replies).",
		tone: 'main',
		mono: true
	});
	const block = allocation(a.icao);
	identity.push({
		label: 'Registered in',
		value: block?.state ?? 'no State’s block',
		title: block
			? `ICAO gives each State a block of addresses (Annex 10, Vol. III, Table 9-1), and the State gives each aircraft on its register one from it, so the address alone says where the aircraft is registered. This one is in ${block.from}–${block.to} (${block.size.toLocaleString()} addresses), allocated to: ${block.state}. That's not necessarily where it flies or whose airline it is: leased aircraft often keep a foreign registration.${block.marks.length ? ` Registrations there start with ${block.marks.join(' or ')}.` : ''}`
			: 'The address is in no State’s block (Annex 10, Vol. III, Table 9-1): ICAO hasn’t allocated it to anyone.',
		tone: 'minor'
	});
	if (a.registration)
		identity.push({
			label: 'Registration',
			value: a.registration.value,
			title:
				'The "tail number" painted on the aircraft. A radar read it from the transponder\'s register 2,1, which few radars ask for. The register sends it without the dash (the 6-bit alphabet has none); the dash goes back after the nationality mark of the State the address belongs to.' +
				source(a.registration, now),
			tone: 'main',
			mono: true
		});
	if (a.category)
		identity.push({
			label: 'Category',
			value: `${a.category.value.set}${a.category.value.code} · ${a.category.value.name}`,
			title:
				"Emitter category: what kind of aircraft this is. For aircraft it's the weight class (maximum take-off weight), which decides how much wake turbulence it leaves and so how far behind it others must fly. Set A–D from the type code, the number from the message (DO-260B Table A-2-8). It picks the symbol on the map." +
				source(a.category, now),
			tone: 'minor'
		});
	if (a.squawk) {
		const special = SPECIAL_SQUAWKS[a.squawk.value];
		identity.push({
			label: 'Squawk',
			value: special ? `${a.squawk.value} · ${special.meaning}` : a.squawk.value,
			title:
				'The Mode A code: four octal digits (0–7) that ATC gives each flight, so the radar can tell flights apart; also what older radars without Mode S see. A few codes have a fixed meaning: 7500 hijack, 7600 radio failure, 7700 emergency.' +
				source(a.squawk, now),
			tone: special?.emergency ? 'alert' : 'main',
			mono: true
		});
	}
	add('Identity', identity);

	// --- position ------------------------------------------------------------------------
	const position: Section['fields'] = [];
	const p = a.position;
	if (p) {
		const shown = shownPosition(a, now);
		position.push({
			label: 'Position',
			value: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
			title: `Latitude, longitude (WGS84), from Compact Position Reporting: the message only says where the aircraft is within a grid zone, ${
				p.from === 'pair'
					? 'and an even and an odd message together (global decoding) say which zone'
					: "and the zone came from the aircraft's own position a moment earlier (local decoding)"
			}. CPR resolves about 5 m (1.25 m on the ground).${source({ value: null, t: p.t, from: p.surface ? 'TC 5–8' : 'TC 9–18' }, now)}`,
			tone: 'main',
			mono: true
		});
		if (receiver) {
			const km = distanceKm(receiver, p);
			const b = bearing(receiver, p);
			position.push({
				label: 'From receiver',
				value: `${distanceText(km, unit)} ${compass(b)} (${deg(b)})`,
				title: `Distance along the great circle from the antenna, and the direction you'd look in (degrees from true north). ${n(km)} km = ${n(km / KM_PER_NM)} NM: a nautical mile is one minute of latitude, 1,852 m.`,
				tone: 'main'
			});
		}
		if (!a.confirmed)
			position.push({
				label: 'Not on the map',
				value: 'unconfirmed',
				title:
					'A first position counts only once the next one agrees with it (or the last one is more than a minute old). One wrong pair of messages would otherwise put the aircraft anywhere for a moment. The map only draws confirmed positions.',
				tone: 'alert'
			});
		else if (shown && shown.extrapolatedKm > 0 && shown.age >= 1000)
			position.push({
				label: 'On the map',
				value: `moved on ${distanceText(shown.extrapolatedKm, unit)} (${Math.round(shown.age / 1000)} s)`,
				title: `The last position is ${(shown.age / 1000).toFixed(1)} s old. Positions come about twice a second, but some get lost. In between, the map moves the symbol along from the last position with the ground speed and track (dead reckoning), for up to 15 s; in a turn along the arc, at the measured turn rate.`,
				tone: 'minor'
			});
		if (a.rejected > 0)
			position.push({
				label: 'Rejected',
				value: `${a.rejected} position${a.rejected === 1 ? '' : 's'}`,
				title: `Positions that failed the plausibility checks: too far from the last one for the time between them, or beyond the radio horizon. Last reason: ${a.lastRejection?.value ?? '–'}.`,
				tone: 'alert'
			});
	} else {
		position.push({
			label: 'Position',
			value: 'none',
			title: a.adsb
				? 'It sends ADS-B, but no position so far: either its position messages are TC 0 ("no position information", e.g. no GPS fix), or not enough of them got through to decode one (that needs an even and an odd message within 10 s).'
				: "No ADS-B at all: only replies to radars (altitude, squawk). Those don't say where the aircraft is. A ground radar knows from its antenna's direction and the reply's delay; one receiver that only listens can't (several receivers timing the same reply could: multilateration).",
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
				"Barometric (pressure) altitude: the height at which the standard atmosphere has the pressure measured outside, with 1013.25 hPa at sea level. Every aircraft measures the same way, so they are separated correctly even when the real height differs with the weather. In hundreds of feet it's the flight level: FL350 = 35,000 ft. Below the transition altitude (5,000 ft in Germany) pilots set the local pressure (QNH) instead, and their altimeter shows the height above sea level; this value is still the standard one." +
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
			title: `How fast it climbs (+) or descends (−), in feet per minute, from ${r.source === 'GNSS' ? 'satellite navigation' : 'the change in air pressure'}. Airliners climb at 1,000–3,000 ft/min and descend at about 1,000–2,000; under 100 ft/min counts as level here (64 ft/min is the message's step).${source(a.verticalRate, now)}`,
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
					'Speed over the ground, in knots (nautical miles per hour). Not the speed through the air: a 100 kt tailwind in the jet stream adds 100 kt. Sent as east-west and north-south components, the speed is their Pythagorean sum.' +
					source(a.ground, now),
				tone: 'main'
			},
			{
				label: 'Track',
				value: `${deg(g.track)} ${compass(g.track)}`,
				title:
					'The direction it moves over the ground, degrees clockwise from true north: where the symbol points. Where the nose points (the heading) differs by the drift angle: with wind from the side the aircraft flies slightly crabwise.' +
					source(a.ground, now),
				tone: 'main'
			}
		);
	}
	if (a.turnRate && a.ground && !p?.surface) {
		const r = a.turnRate.value;
		const straight = Math.abs(r) < TURNING;
		flight.push({
			label: 'Turn',
			value: straight ? 'straight' : `${Math.abs(r).toFixed(1)}°/s ${r > 0 ? 'right' : 'left'}`,
			title: `How fast the track changes, measured here from the ground tracks of the last ${TURN_WINDOW_MS / 1000} s (a straight line fitted through them), so it lags a few seconds behind the start and end of a turn. Under ${TURNING}°/s counts as straight: flying straight, the track wobbles by a few hundredths of a degree per second. A "standard rate" turn is 3°/s (a full circle in two minutes); airliners at cruise turn at 1–1.5°/s, at 25° of bank.${source(a.turnRate, now)}`,
			tone: straight ? 'minor' : 'main'
		});
	}
	if (a.air && !p?.surface) {
		const { heading, speed, type } = a.air.value;
		const why =
			"It sends its speed through the air instead of over the ground (TC 19 subtype 3, or 4 when supersonic). Aircraft do that when they can't measure their ground speed: normally the satellite receiver measures it (from the Doppler shift of the satellites' signals), so this usually means it has no satellite fix: jamming, or a fault. Without knowing the wind, heading and airspeed don't say where it goes over the ground, so the map doesn't move it along.";
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
				title: `Where the nose points, not where it goes: the wind blows it sideways (the drift angle). ${
					ref === null
						? 'Relative to true or magnetic north: its operational status (TC 31) will say which.'
						: ref === 'magnetic'
							? `Relative to magnetic north, where the compass points (its operational status says so, or it's ADS-B version 0/1, where headings are always magnetic). True north is ${deg(asTrue)}: the World Magnetic Model gives the declination there.`
							: 'Relative to true north (its operational status, TC 31, says so: HRD).'
				} ${why}${source(a.air, now)}`,
				tone: 'main'
			});
		}
		if (speed !== null)
			flight.push({
				label: 'Airspeed',
				value: `${n(speed)} kt ${type}`,
				title: `${
					type === 'IAS'
						? 'Indicated airspeed: what the pitot tube measures, the speed the wings feel. Up high the air is thin, so it reads far less than the speed through the air: 250 kt IAS is about 460 kt true at FL380.'
						: 'True airspeed: the speed through the air. Over the ground, add the tailwind or subtract the headwind.'
				} ${why}${source(a.air, now)}`,
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
			title: `The dotted line ahead of the symbol: where it gets to if it keeps doing what it does now, ${PREDICT_S / 60} min ahead (${PREDICT_SELECTED_S / 60} min with minute marks while selected), in the colour of the altitude it will have there. Radar screens draw the same (straight) as a "speed vector". The model: the same ground speed; the measured turn rate, ending at the selected heading if the autopilot steers by heading (in LNAV it follows a route we can't see, so the line stops after ${MAX_OPEN_TURN}° of turn); the vertical rate, levelling off at the selected altitude if that's where it's heading. It can't foresee a turn or a climb before it starts.`,
			tone: 'minor'
		});
	} else if (p && !p.surface && a.confirmed) {
		flight.push({
			label: 'Predicted',
			value: 'no',
			title: a.air
				? "No dotted line ahead of it: it sends its airspeed and heading, not its speed and direction over the ground, and without the wind those don't say where it goes."
				: 'No dotted line ahead of it: that needs a ground speed and track (TC 19) from within 10 s of the position, and none got through. Weak or distant aircraft lose many of their messages.',
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
				'On the ground the speed is sent as a step on a non-linear scale: fine while taxiing (1/8 kt steps when slow), coarse on the runway (5 kt steps above 100 kt). The direction is the ground track or the heading; the operational status message says which.' +
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
				"The altitude the autopilot is set to fly to: dialled in by the pilots on the glareshield panel (MCP on Boeings, FCU on Airbus) or planned by the flight management system (FMS). Where it'll level off: compare it with the altitude." +
				source(a.target!, now),
			tone: 'main'
		});
	if (target?.selectedHeading !== null && target?.selectedHeading !== undefined)
		intent.push({
			label: 'Selected heading',
			value: deg(target.selectedHeading),
			title:
				"The heading set on the autopilot. Only flown if the autopilot is in heading mode; in LNAV the flight management system steers along the route instead, and this is just what's dialled in." +
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
				'What the automation is doing. LNAV: following the route in the flight management system sideways. VNAV: its planned climbs and descents. Altitude hold: keeping the current altitude. Approach: following a landing guidance signal (ILS).' +
				source(a.target!, now),
			tone: 'main'
		});
	}
	if (target?.qnh)
		intent.push({
			label: 'Altimeter',
			value: `${target.qnh.toFixed(1)} hPa${Math.abs(target.qnh - 1013.2) < 0.5 ? ' (standard)' : ''}`,
			title:
				"The pressure the altimeter is set to. 1013.2 hPa is the standard setting, used above the transition altitude: then the altimeter shows the flight level. Lower down, pilots set the local QNH, the airport's pressure reduced to sea level. Sent in steps of 0.8 hPa, so the standard 1013.25 comes out as 1013.6." +
				source(a.target!, now),
			tone: 'minor'
		});
	add('Autopilot', intent);

	// --- Comm-B --------------------------------------------------------------------------
	const radar: Section['fields'] = [];
	const hs = a.commB.headingAndSpeed;
	const tt = a.commB.trackAndTurn;
	if (hs?.value.heading !== null && hs?.value.heading !== undefined)
		radar.push({
			label: 'Heading',
			value: `${deg(hs.value.heading)} magnetic`,
			title:
				'Where the nose points, relative to magnetic north (the compass), from register 6,0. Not broadcast: a ground radar asked for it. With the track and the speeds, it gives the wind (/weather).' +
				source(hs, now),
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
				'Indicated airspeed: what the pitot tube measures, the speed the wings feel (it drops with height as the air thins, though the plane goes as fast). Mach: the speed as a fraction of the speed of sound out there; airliners cruise at Mach 0.78–0.85. Register 6,0.' +
				source(hs, now),
			tone: 'main'
		});
	if (tt?.value.tas !== null && tt?.value.tas !== undefined)
		radar.push({
			label: 'True airspeed',
			value: `${n(tt.value.tas)} kt`,
			title:
				'Speed through the air (not over the ground): the ground speed minus the headwind. Register 5,0.' +
				source(tt, now),
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
				'Roll angle: how far the wings are tilted. An aircraft turns by banking; airliners use up to 25–30°. Register 5,0.' +
				source(tt, now),
			tone: 'main'
		});
	add('From radar interrogations (Comm-B)', radar);

	// --- reception -----------------------------------------------------------------------
	const reception: Section['fields'] = [
		{
			label: 'Messages',
			value: `${n(a.messages)} in ${ago(now - a.firstSeen).replace(' ago', '')}`,
			title:
				'Messages received from it since it appeared: ADS-B broadcasts, all-call replies, and replies to radars whose address could be verified.',
			tone: 'minor'
		},
		{
			label: 'Last heard',
			value: ago(now - a.lastSeen),
			title: 'When the latest message from it arrived. After a minute of silence it is dropped.',
			tone: 'minor'
		}
	];
	if (a.signal !== null)
		reception.push({
			label: 'Signal',
			value: `${a.signal.toFixed(1)} dBFS`,
			title:
				"How loud the latest message was, in decibels below the receiver's full scale (0 dBFS: as loud as it can measure; every −6 dB is half the amplitude). Nearer is louder, but transmitters differ in power, antennas aren't equally sensitive in every direction, and buildings or hills in the way dim what's behind them.",
			tone: 'minor'
		});
	add('Reception', reception);
	return sections;
}
