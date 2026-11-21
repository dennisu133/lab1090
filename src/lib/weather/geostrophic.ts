/**
 * The geostrophic wind: the wind the slope of the pressure surfaces calls for, measured
 * with GNSS − baro alone. No heading, no airspeed, no Comm-B.
 *
 * An aircraft in level flight holds its pressure altitude: it follows a surface of
 * constant pressure. Those surfaces aren't flat. Where the air below is cold or the
 * pressure low, they sag; where it's warm or high, they bulge. So as the aircraft flies,
 * its GNSS height rises and falls with the surface, while its pressure altitude stays put:
 * GNSS − baro changes along the track. Meteorologists call that difference the D-value.
 *
 * On the rotating Earth, air doesn't flow straight down such a slope. Above the friction
 * near the ground, the pressure force (downhill) and the Coriolis force (to the right of
 * the motion, in the northern hemisphere) balance when the air flows *along* the height
 * contours, with the low side on its left:
 *
 *   wind towards the east  = −(g / f) · slope towards the north
 *   wind towards the north =  (g / f) · slope towards the east
 *
 * with g = 9.80665 m/s² and f = 2Ω · sin(latitude), the Coriolis parameter (1.15 × 10⁻⁴ /s
 * at 52°N). A slope of 100 ft per 100 km (1 : 3,300) makes 51 kt. That's geostrophic
 * balance, the first thing weather maps show: wind along the isobars.
 *
 * Navigators used exactly this in the 1940s ("pressure pattern flying"): a radar altimeter
 * against the barometric one gave the D-value, and how fast it changed along the track gave
 * the crosswind (Bellamy's formula), with no ground in sight. One aircraft only sees the
 * slope along its track; aircraft on different tracks together give the full slope.
 *
 * How: each aircraft's samples at one level are a segment. Every segment gets its own
 * offset (each aircraft's altimeter has its own error, often ±50 ft, and each level its
 * own column temperature), so only how GNSS − baro changes *within* a segment counts: a
 * least-squares plane through all segments at once. Positions are the aircraft's ADS-B
 * positions; the geoid (sea level against the ellipsoid) changes along the way too, and
 * is taken off first (column.ts).
 *
 * The result is a balance, not a measurement of the wind. Where the air curves around a
 * low (or near the ground, with friction) the real wind is slower; around a high, faster.
 * It's also an average over every level in the fit and the whole area the aircraft cover.
 *
 * Pure, no state here.
 */
import { G0 } from '#lib/modes/air-data.ts';
import { FT, KT } from '#lib/units.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { column, type HeightReference } from './column';
import type { ColumnSample } from './profile';
import { meanVector, windOf, type Vector, type Wind } from './wind';

/** The Earth's rotation, rad/s (one turn per sidereal day). */
const OMEGA = 7.292_115e-5;
/** km per degree of latitude (and of longitude at the equator). */
const KM_PER_DEGREE = 111.32;

/** A segment needs this many samples … */
export const MIN_SEGMENT_SAMPLES = 3;
/** … over at least this distance, km. */
export const MIN_SEGMENT_KM = 20;
/** At least this many aircraft, so that leaving one out still leaves a fit. */
export const MIN_GEOSTROPHIC_AIRCRAFT = 3;
/**
 * The flights must reach at least this far in every direction, km (rms, within their
 * segments): along one airway only, the slope across it is unknown.
 */
export const MIN_SPREAD_KM = 10;

export interface Segment {
	icao: string;
	/** Pressure altitude, ft, rounded to 100. */
	level: number;
	/** From the origin, km, with the D-value (geopotential height − pressure altitude), ft. */
	points: { north: number; east: number; offset: number }[];
}

export type Geostrophic =
	| {
			found: true;
			wind: Wind;
			/** ft per 100 km: how much the pressure surfaces rise towards the north and east. */
			slope: Vector;
			/** f, 1/s, at the mean latitude of the samples. */
			coriolis: number;
			latitude: number;
			/** The segments that went in (for the map). */
			segments: Segment[];
			aircraft: number;
			samples: number;
			/** Pressure altitudes covered, ft. */
			levels: [number, number];
			/** What the plane leaves unexplained, ft rms: GNSS − baro comes in 25 ft steps. */
			residual: number;
			/**
			 * The jackknife standard error over aircraft, kt: from refitting without each one in
			 * turn. The honest error bar, since an aircraft's samples aren't independent of each
			 * other. (Larger than the most any single refit moves the wind.)
			 * Null when fewer than two of the refits still had the spread to find a slope.
			 */
			uncertainty: number | null;
			/** How far the flights reach in their least-covered direction, km rms. */
			spread: number;
	  }
	| { found: false; reason: string; segments: Segment[] };

/** Local flat coordinates around `origin`, km: fine over a few hundred km. */
function plane(origin: LatLon) {
	const cos = Math.cos(origin.lat * (Math.PI / 180));
	return (p: LatLon) => ({
		north: (p.lat - origin.lat) * KM_PER_DEGREE,
		east: (((p.lon - origin.lon + 540) % 360) - 180) * KM_PER_DEGREE * cos
	});
}

/** Level-flight segments: one aircraft at one level, far enough along. */
export function segments(
	columns: ColumnSample[],
	origin: LatLon,
	heights: HeightReference
): Segment[] {
	const toKm = plane(origin);
	const byKey = Map.groupBy(
		columns.filter((c) => c.position.from === 'ADS-B'),
		(c) => `${c.icao} ${Math.round(c.altitude / 100) * 100}`
	);
	return [...byKey].flatMap(([key, cs]) => {
		const [icao, level] = key.split(' ');
		if (cs.length < MIN_SEGMENT_SAMPLES) return [];
		const points = cs.map((c) => ({
			...toKm(c.position),
			// The QNH doesn't matter for the offset, only for splitting it up.
			offset: column(c, { qnh: 1013.25, heights }).offset
		}));
		const first = points[0];
		const far = Math.max(
			...points.map((p) => Math.hypot(p.north - first.north, p.east - first.east))
		);
		return far < MIN_SEGMENT_KM ? [] : [{ icao, level: Number(level), points }];
	});
}

/**
 * The plane through the segments, each with its own offset: least squares on the
 * deviations from each segment's mean. Slope in ft per km.
 */
function fit(segs: Segment[]) {
	let nn = 0;
	let ne = 0;
	let ee = 0;
	let nz = 0;
	let ez = 0;
	const centred = segs.flatMap((s) => {
		const k = s.points.length;
		const m = s.points.reduce(
			(a, p) => ({
				north: a.north + p.north / k,
				east: a.east + p.east / k,
				offset: a.offset + p.offset / k
			}),
			{ north: 0, east: 0, offset: 0 }
		);
		return s.points.map((p) => ({
			north: p.north - m.north,
			east: p.east - m.east,
			offset: p.offset - m.offset
		}));
	});
	for (const p of centred) {
		nn += p.north * p.north;
		ne += p.north * p.east;
		ee += p.east * p.east;
		nz += p.north * p.offset;
		ez += p.east * p.offset;
	}
	const det = nn * ee - ne * ne;
	const slope = { north: (nz * ee - ez * ne) / det, east: (ez * nn - nz * ne) / det };
	const residual = Math.sqrt(
		centred.reduce((s, p) => s + (p.offset - slope.north * p.north - slope.east * p.east) ** 2, 0) /
			centred.length
	);
	// The smaller eigenvalue of the positions' covariance: the least-covered direction.
	const n = centred.length;
	const [a, b, c] = [nn / n, ne / n, ee / n];
	const spread = Math.sqrt((a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b));
	return { slope, residual, spread, samples: n };
}

/** The wind (kt, vector) that balances a slope (ft per km) at Coriolis parameter f. */
export function balancingWind(slope: Vector, f: number): Vector {
	// ft per km → m per m: × FT / 1000.
	const perMetre = { north: (slope.north * FT) / 1000, east: (slope.east * FT) / 1000 };
	return {
		north: ((G0 / f) * perMetre.east) / KT,
		east: (-(G0 / f) * perMetre.north) / KT
	};
}

/** `origin`: where the map's km count from, the receiver. It doesn't change the fit. */
export function geostrophicWind(
	columns: ColumnSample[],
	origin: LatLon,
	heights: HeightReference
): Geostrophic {
	const positioned = columns.filter((c) => c.position.from === 'ADS-B');
	if (positioned.length === 0)
		return { found: false, reason: 'No GNSS − baro with an ADS-B position yet.', segments: [] };
	const segs = segments(positioned, origin, heights);
	const aircraft = [...new Set(segs.map((s) => s.icao))];
	if (aircraft.length < MIN_GEOSTROPHIC_AIRCRAFT)
		return {
			found: false,
			reason: `Needs aircraft in level flight that have each covered ${MIN_SEGMENT_KM} km, from at least ${MIN_GEOSTROPHIC_AIRCRAFT} aircraft (so far ${aircraft.length}).`,
			segments: segs
		};
	const all = fit(segs);
	if (!(all.spread >= MIN_SPREAD_KM))
		return {
			found: false,
			reason: `The flights all go the same way (spread across them ${all.spread.toFixed(0)} km, at least ${MIN_SPREAD_KM}): that only gives the slope along their track.`,
			segments: segs
		};

	const latitude = positioned.reduce((s, c) => s + c.position.lat, 0) / positioned.length;
	const f = 2 * OMEGA * Math.sin(latitude * (Math.PI / 180));
	const vector = balancingWind(all.slope, f);

	// Jackknife over aircraft: refit without each one in turn.
	const others = aircraft.map((icao) => {
		const rest = fit(segs.filter((s) => s.icao !== icao));
		return rest.spread >= 1 ? balancingWind(rest.slope, f) : null;
	});
	const ok = others.filter((v): v is Vector => v !== null);
	let uncertainty: number | null = null;
	const m = meanVector(ok);
	if (m && ok.length >= 2) {
		uncertainty = Math.sqrt(
			((ok.length - 1) / ok.length) *
				ok.reduce((s, v) => s + (v.north - m.north) ** 2 + (v.east - m.east) ** 2, 0)
		);
	}

	const levels = segs.map((s) => s.level);
	return {
		found: true,
		wind: windOf(vector),
		slope: { north: all.slope.north * 100, east: all.slope.east * 100 },
		coriolis: f,
		latitude,
		segments: segs,
		aircraft: aircraft.length,
		samples: all.samples,
		levels: [Math.min(...levels), Math.max(...levels)],
		residual: all.residual,
		uncertainty,
		spread: all.spread
	};
}
