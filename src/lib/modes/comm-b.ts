/**
 * Which register did a Comm-B reply come from?
 *
 * The radar knows (it asked for it), but the reply doesn't say. A receiver that only
 * listens has to infer it from the 56 bits, in three steps:
 *
 * 1. Some registers start with their own number (1,0 / 2,0 / 3,0) or have a fixed shape
 *    (1,7: 32 zero bits at the end). If one of those fits, that's it.
 * 2. For the others, rule out every register the bits can't be: a status bit says "no
 *    data" but the value bits aren't zero, reserved bits are set, a value is out of range.
 * 3. If more than one is left (5,0 and 6,0 often both fit), compare each reading with what
 *    the same aircraft broadcast via ADS-B: the one that agrees wins.
 *
 * Step 3 also lets registers without any structure of their own (5,1, 5,2, and ADS-B
 * registers read via Comm-B) be recognised: they only count if ADS-B confirms them.
 *
 * Registers hardly any radar asks for (4,4, 4,5, 5,3 and 2,1, see RARE) are a last resort:
 * they are only considered if none of the others fits, and never if ADS-B contradicts them.
 * 2,1 (the registration) needs a confirmation too, from the address rather than ADS-B: the
 * registration has to start with the nationality mark of the State whose block the address
 * is in (nationality.ts).
 *
 * Shared by server and browser; no state here (the ADS-B side comes from AdsbMemory).
 */
import { distanceKm } from '#lib/geo.ts';
import type { Broadcast, Timed } from './adsb-memory';
import { machFromCas } from './air-data';
import { decodeLocal } from './cpr';
import { toHex } from './frame';
import { allocation, formatRegistration, nationalityMark } from './nationality';
import { combineFine, RARE, REGISTERS, type Register, type Registration } from './registers';

export interface Context {
	/** Same clock as the ADS-B timestamps, ms. */
	now: number;
	/** The altitude in the same reply (DF20's AC field), ft. */
	replyAltitude: number | null;
	/** What the aircraft broadcast recently; null if nothing (or the address is unverified). */
	adsb: Broadcast | null;
	/**
	 * The reply's address, if it's trustworthy (the address filter's "known"); null if not.
	 * Register 2,1 is checked against the State it belongs to.
	 */
	address: string | null;
}

export type Unit = 'kt' | '°' | 'ft' | 'hPa' | 'ft/min' | 'km' | '';

/** One value of the register reading, next to the same quantity from somewhere else. */
export interface Comparison {
	/** e.g. "ground speed" */
	quantity: string;
	unit: Unit;
	commB: number | string;
	other: number | string;
	/** Where `other` comes from, e.g. "TC 19" (ADS-B) or "IAS + altitude". */
	from: string;
	/** How long ago the ADS-B value was received, ms; null if it's from the reply itself. */
	ageMs: number | null;
	/** Absolute difference (angles the short way round); null for text. */
	difference: number | null;
	tolerance: number;
	ok: boolean;
}

export interface Candidate {
	bds: string;
	name: string;
	register: Register;
	comparisons: Comparison[];
}

export type How =
	| 'empty' // all 56 bits zero
	| 'fixed' // a register with its own number or a fixed pattern
	| 'only candidate' // all others ruled out by their structure
	| 'ADS-B' // several fitted; the comparison with ADS-B decided
	| 'ambiguous' // several fit equally well
	| 'unknown'; // nothing fits

export interface Inference {
	how: How;
	/** The register these bits came from; null if empty, ambiguous or unknown. */
	best: Candidate | null;
	/** Every register the bits could be. */
	candidates: Candidate[];
	/** Every other register, and why not. */
	rejected: { bds: string; name: string; reason: string }[];
}

/** Registers recognised by a fixed pattern: if one fits, nothing else is considered. */
const FIXED = new Set(['1,0', '1,7', '2,0', '3,0']);
/** Registers with too little structure to recognise on their own: ADS-B must confirm them. */
const NEEDS_ADSB = new Set(['5,1', '5,2', '0,5', '0,6', '0,8', '0,9', '6,1', '6,2', '6,5']);

/** ADS-B values older than this aren't compared with. */
const MAX_AGE_MS = 30_000;
const POSITION_MAX_AGE_MS = 10_000;

export function inferRegister(mb: Uint8Array, context: Context | null): Inference {
	const inference: Inference = { how: 'unknown', best: null, candidates: [], rejected: [] };
	if (mb.every((b) => b === 0)) return { ...inference, how: 'empty' };

	const rare: Candidate[] = [];
	for (const spec of REGISTERS) {
		const reason = spec.reject(mb);
		if (reason) {
			inference.rejected.push({ bds: spec.bds, name: spec.name, reason });
			continue;
		}
		const register = spec.decode(mb);
		const comparisons = context ? compare(register, mb, context) : [];
		const failed = comparisons.filter((c) => !c.ok);
		if (NEEDS_ADSB.has(spec.bds) || spec.bds === '2,1') {
			const [by, without] =
				spec.bds === '2,1'
					? ['The address', 'without a trusted address to check the nationality mark against']
					: ['ADS-B', 'without recent ADS-B to compare with'];
			const why =
				comparisons.length === 0
					? `too little structure to tell ${without}`
					: failed.length > 0 && `${by} disagrees: ${failed.map(mismatch).join('; ')}`;
			if (why) {
				inference.rejected.push({ bds: spec.bds, name: spec.name, reason: why });
				continue;
			}
		}
		if (RARE.has(spec.bds) && failed.length > 0) {
			const reason = `ADS-B disagrees: ${failed.map(mismatch).join('; ')}`;
			inference.rejected.push({ bds: spec.bds, name: spec.name, reason });
			continue;
		}
		const candidate = { bds: spec.bds, name: spec.name, register, comparisons };
		(RARE.has(spec.bds) ? rare : inference.candidates).push(candidate);
	}
	// The rare registers only get a chance when none of the common ones fits.
	if (inference.candidates.length === 0) inference.candidates.push(...rare);
	else {
		for (const c of rare) {
			const reason = 'fits too, but is rarely asked for: only considered when nothing else fits';
			inference.rejected.push({ bds: c.bds, name: c.name, reason });
		}
	}

	const { candidates } = inference;
	const fixed = candidates.find((c) => FIXED.has(c.bds));
	if (fixed) return { ...inference, how: 'fixed', best: fixed };
	if (candidates.length === 0) return inference;
	if (candidates.length === 1) return { ...inference, how: 'only candidate', best: candidates[0] };

	// Several fit. Rank by agreement with ADS-B: all comparisons ok (closest first), then
	// those with nothing to compare, then those that disagree.
	const ranked = candidates
		.map((c) => ({ c, tier: tier(c), score: score(c) }))
		.sort((a, b) => a.tier - b.tier || a.score - b.score);
	const [first, second] = ranked;
	const decided = first.tier < second.tier || (first.tier === 0 && first.score < second.score);
	return decided
		? { ...inference, how: 'ADS-B', best: first.c }
		: { ...inference, how: 'ambiguous' };
}

/** "altitude 12,450 ft vs 38,000 ft", "position 87.2 km off", "callsign "X" vs "Y"" */
export function mismatch(c: Comparison): string {
	if (c.unit === 'km') return `${c.quantity} ${c.difference!.toFixed(1)} km off`;
	if (typeof c.commB === 'string') return `${c.quantity} "${c.commB}" vs "${c.other}"`;
	const suffix = c.unit === '' || c.unit === '°' ? c.unit : ` ${c.unit}`;
	const digits = c.unit === '' ? 3 : 1; // Mach: 0.804
	const f = (x: number | string) =>
		typeof x === 'number'
			? x.toLocaleString(undefined, { maximumFractionDigits: digits }) + suffix
			: x;
	return `${c.quantity} ${f(c.commB)} vs ${f(c.other)}`;
}

function tier(c: Candidate): number {
	if (c.comparisons.length === 0) return 1;
	return c.comparisons.every((x) => x.ok) ? 0 : 2;
}

/** Mean difference relative to the tolerance: 0 = perfect, 1 = at the limit. */
function score(c: Candidate): number {
	const numeric = c.comparisons.filter((x) => x.difference !== null);
	if (numeric.length === 0) return 0;
	return numeric.reduce((sum, x) => sum + x.difference! / x.tolerance, 0) / numeric.length;
}

// --- the comparisons ---------------------------------------------------------------------

interface Other<T> {
	value: T;
	from: string;
	ageMs: number | null;
}

function fresh<T>(timed: Timed<T> | null, now: number, maxAge = MAX_AGE_MS): Other<T> | null {
	if (!timed || now - timed.t > maxAge) return null;
	return { value: timed.value, from: timed.from, ageMs: Math.max(0, now - timed.t) };
}

function numeric(
	quantity: string,
	unit: Unit,
	commB: number | null,
	other: Other<number> | null,
	tolerance: number,
	angle = false
): Comparison[] {
	if (commB === null || other === null) return [];
	let difference = Math.abs(commB - other.value);
	if (angle) difference = Math.min(difference % 360, 360 - (difference % 360));
	return [
		{
			quantity,
			unit,
			commB,
			other: other.value,
			from: other.from,
			ageMs: other.ageMs,
			difference,
			tolerance,
			ok: difference <= tolerance
		}
	];
}

function text(quantity: string, commB: string, other: Other<string> | null): Comparison[] {
	if (other === null) return [];
	const ok = commB === other.value;
	return [
		{
			quantity,
			unit: '',
			commB,
			other: other.value,
			from: other.from,
			ageMs: other.ageMs,
			difference: null,
			tolerance: 0,
			ok
		}
	];
}

/** Within 1 km, plus what an airliner covers while the ADS-B position aged (~0.3 km/s). */
function positionTolerance(ageMs: number | null): number {
	return 1 + 0.3 * ((ageMs ?? 0) / 1000);
}

function map<T, U>(other: Other<T> | null, f: (value: T) => U | null): Other<U> | null {
	if (!other) return null;
	const value = f(other.value);
	return value === null ? null : { ...other, value };
}

function compare(
	register: Register,
	mb: Uint8Array,
	{ now, replyAltitude, adsb, address }: Context
): Comparison[] {
	if (register.bds === '2,1') return registrationCheck(register, address);
	const altitude: Other<number> | null =
		replyAltitude !== null
			? { value: replyAltitude, from: 'this reply', ageMs: null }
			: fresh(adsb?.altitude ?? null, now);
	if (!adsb) {
		// Only the reply itself to compare with.
		if (register.bds === '6,0' && register.ias !== null && altitude)
			return machCheck(register.mach, register.ias, altitude);
		return [];
	}
	const position = fresh(adsb.position, now, POSITION_MAX_AGE_MS);
	const ground = fresh(adsb.ground, now);
	const air = fresh(adsb.air, now);
	const rate = fresh(adsb.verticalRate, now);
	const selected = fresh(adsb.selectedAltitude, now);

	const distance = (commB: { lat: number; lon: number } | null) => {
		if (!position || !commB) return [];
		const km = distanceKm(commB, position.value);
		const tolerance = positionTolerance(position.ageMs);
		return [
			{
				quantity: 'position',
				unit: 'km',
				commB: '',
				other: '',
				from: position.from,
				ageMs: position.ageMs,
				difference: km,
				tolerance,
				ok: km <= tolerance
			} satisfies Comparison
		];
	};

	switch (register.bds) {
		case '2,0':
			return text('callsign', register.callsign, fresh(adsb.callsign, now, 5 * 60_000));
		case '4,0':
			return [
				...numeric(
					'selected altitude',
					'ft',
					register.mcpAltitude,
					map(selected, (s) => (s.source === 'MCP/FCU' ? s.feet : null)),
					50
				),
				...numeric(
					'FMS altitude',
					'ft',
					register.fmsAltitude,
					map(selected, (s) => (s.source === 'FMS' ? s.feet : null)),
					50
				),
				...numeric('pressure setting', 'hPa', register.baroSetting, fresh(adsb.qnh, now), 1)
			];
		case '5,0':
			return [
				...numeric(
					'ground speed',
					'kt',
					register.groundSpeed,
					map(ground, (g) => g.speed),
					20
				),
				...numeric(
					'track',
					'°',
					register.track,
					map(ground, (g) => g.track),
					10,
					true
				),
				...numeric(
					'true airspeed',
					'kt',
					register.tas,
					map(air, (a) => (a.type === 'TAS' ? a.speed : null)),
					20
				)
			];
		case '6,0': {
			// Magnetic heading vs. true track: wind and the magnetic declination both add up.
			const heading = map(air, (a) => a.heading) ?? map(ground, (g) => g.track);
			return [
				...numeric('heading', '°', register.heading, heading, 30, true),
				...numeric(
					'indicated airspeed',
					'kt',
					register.ias,
					map(air, (a) => (a.type === 'IAS' ? a.speed : null)),
					20
				),
				...(register.ias !== null && altitude
					? machCheck(register.mach, register.ias, altitude)
					: []),
				...numeric(
					'vertical rate',
					'ft/min',
					register.baroRate,
					map(rate, (r) => (r.source === 'baro' ? r.rate : null)),
					500
				),
				...numeric(
					'vertical rate',
					'ft/min',
					register.inertialRate,
					map(rate, (r) => (r.source === 'GNSS' ? r.rate : null)),
					500
				)
			];
		}
		case '5,1':
			return [
				...distance(register),
				...numeric('altitude', 'ft', register.altitude, altitude, 100)
			];
		case '5,2': {
			const combined = position && {
				lat: combineFine(register.latFine, position.value.lat),
				lon: combineFine(register.lonFine, position.value.lon)
			};
			// Some aircraft put their barometric altitude here, others their GNSS height.
			const baro = numeric('altitude', 'ft', register.altitude, altitude, 100);
			const gnss = numeric(
				'GNSS height',
				'ft',
				register.altitude,
				altitude && map(fresh(adsb.gnssMinusBaro, now), (d) => altitude.value + d),
				100
			);
			const height = baro[0]?.ok || gnss.length === 0 ? baro : gnss;
			return [...distance(combined), ...height];
		}
		case '5,3': {
			const heading = map(air, (a) => a.heading) ?? map(ground, (g) => g.track);
			return [
				...numeric('heading', '°', register.heading, heading, 30, true),
				...numeric(
					'indicated airspeed',
					'kt',
					register.ias,
					map(air, (a) => (a.type === 'IAS' ? a.speed : null)),
					20
				),
				...numeric(
					'true airspeed',
					'kt',
					register.tas,
					map(air, (a) => (a.type === 'TAS' ? a.speed : null)),
					20
				),
				...(register.ias !== null && altitude
					? machCheck(register.mach, register.ias, altitude)
					: []),
				...numeric(
					'vertical rate',
					'ft/min',
					register.verticalRate,
					map(rate, (r) => r.rate),
					500
				)
			];
		}
		case '0,5':
		case '0,6':
		case '0,8':
		case '0,9':
		case '6,1':
		case '6,2':
		case '6,5': {
			const sent = adsb.recent.get(toHex(mb));
			if (sent !== undefined && now - sent <= MAX_AGE_MS) {
				return [
					{
						quantity: 'all 56 bits',
						unit: '',
						commB: 'identical',
						other: 'identical',
						from: 'DF17',
						ageMs: Math.max(0, now - sent),
						difference: null,
						tolerance: 0,
						ok: true
					}
				];
			}
			const s = register.squitter;
			if (s.kind === 'identification')
				return text('callsign', s.callsign, fresh(adsb.callsign, now, 5 * 60_000));
			if (s.kind === 'airborne-position') {
				const local = s.cpr && position && decodeLocal(s.cpr, position.value);
				return [...distance(local), ...numeric('altitude', 'ft', s.altitude.feet, altitude, 100)];
			}
			if (s.kind === 'velocity') {
				return [
					...numeric(
						'ground speed',
						'kt',
						s.ground?.speed ?? null,
						map(ground, (g) => g.speed),
						20
					),
					...numeric(
						'track',
						'°',
						s.ground?.track ?? null,
						map(ground, (g) => g.track),
						10,
						true
					),
					...numeric(
						'airspeed',
						'kt',
						s.air?.speed ?? null,
						map(air, (a) => a.speed),
						20
					)
				];
			}
			if (s.kind === 'target-state' && s.subtype === 1) {
				return [
					...numeric(
						'selected altitude',
						'ft',
						s.selectedAltitude?.feet ?? null,
						map(selected, (x) => x.feet),
						50
					),
					...numeric('pressure setting', 'hPa', s.qnh, fresh(adsb.qnh, now), 1)
				];
			}
			// Surface positions, aircraft and operational status: only an exact copy confirms them.
			return [];
		}
		default:
			return [];
	}
}

/**
 * Does the registration start with a nationality mark of the State the address belongs to?
 * Nothing to compare if the address is unknown, unallocated or its State's marks are.
 */
function registrationCheck(r: Registration, address: string | null): Comparison[] {
	const block = address ? allocation(address) : null;
	if (!block || block.marks.length === 0) return [];
	const mark = nationalityMark(r.registration, block.marks);
	return [
		{
			quantity: 'registration',
			unit: '',
			commB: mark ? formatRegistration(r.registration, mark) : r.registration,
			other: block.marks.map((m) => `${m}…`).join(' or '),
			from: `Address block (${block.state})`,
			ageMs: null,
			difference: null,
			tolerance: 0,
			ok: mark !== null
		}
	];
}

/** Mach should follow from the indicated airspeed and the altitude (see air-data.ts). */
function machCheck(mach: number | null, ias: number, altitude: Other<number>): Comparison[] {
	return numeric(
		'Mach',
		'',
		mach,
		{
			...altitude,
			value: machFromCas(ias, altitude.value),
			from: `IAS at ${altitude.from === 'this reply' ? 'reply' : 'ADS-B'} altitude`
		},
		0.03
	);
}
