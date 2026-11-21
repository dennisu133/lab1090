/**
 * Magnetic declination from the World Magnetic Model (WMM2025).
 *
 * Why /weather needs it: register 6,0 gives the aircraft's heading relative to *magnetic*
 * north (what the cockpit's heading display shows), while track and wind are relative
 * to *true* north. The angle between the two norths is the declination (pilots say
 * "variation"): true heading = magnetic heading + declination, east positive. In eastern
 * Germany it's about +5°, and it drifts by ~0.15° per year.
 *
 * It matters a lot: at 450 kt true airspeed, every 1° of heading error puts 450 · sin 1° ≈
 * 8 kt of fake crosswind into the wind estimate.
 *
 * The model: the Earth's main field is the gradient of a potential, written as a sum of
 * spherical harmonics up to degree 12 (90 pairs of Gauss coefficients g, h, plus how fast
 * each changes per year):
 *
 *   V(r, θ, λ) = a Σₙ (a/r)ⁿ⁺¹ Σₘ (gₙᵐ cos mλ + hₙᵐ sin mλ) Pₙᵐ(cos θ)
 *
 * with r, θ, λ the geocentric radius, colatitude and longitude, a = 6371.2 km, and Pₙᵐ the
 * Schmidt semi-normalised associated Legendre functions. B = −∇V gives the north (X), east
 * (Y) and down (Z) components, and the declination is atan2(Y, X).
 *
 * Source: NOAA/BGS, "The US/UK World Magnetic Model for 2025–2030: Technical Report"
 * (equations 4–19). Tested against NOAA's published test values (fixtures/wmm/).
 *
 * Pure, no state here.
 */
import { FT } from '#lib/units.ts';
import { WMM_COF } from './wmm2025';

/** The model's reference radius, km (not the Earth's: it's just where the series is written). */
const A = 6371.2;
/** WGS 84 ellipsoid: semi-major axis (km) and flattening. GPS positions are relative to it. */
const WGS84_A = 6378.137;
const WGS84_F = 1 / 298.257_223_563;
const E2 = WGS84_F * (2 - WGS84_F);

const N_MAX = 12;

interface Model {
	epoch: number;
	/** Indexed [n][m]. */
	g: number[][];
	h: number[][];
	gDot: number[][];
	hDot: number[][];
}

function parse(cof: string): Model {
	const [header, ...rows] = cof.trim().split('\n');
	const square = () => Array.from({ length: N_MAX + 1 }, () => new Array(N_MAX + 1).fill(0));
	const model = { epoch: Number(header.trim().split(/\s+/)[0]), g: square(), h: square() };
	const gDot = square();
	const hDot = square();
	for (const row of rows) {
		const [n, m, g, h, gd, hd] = row.trim().split(/\s+/).map(Number);
		model.g[n][m] = g;
		model.h[n][m] = h;
		gDot[n][m] = gd;
		hDot[n][m] = hd;
	}
	return { ...model, gDot, hDot };
}

const MODEL = parse(WMM_COF);

/** First and last year the model is meant for. */
export const WMM_VALID = { from: MODEL.epoch, to: MODEL.epoch + 5 };

/** Decimal year, e.g. 2026.87 for mid-November 2026 (what the model's time terms use). */
export function decimalYear(ms: number): number {
	const date = new Date(ms);
	const year = date.getUTCFullYear();
	const start = Date.UTC(year, 0, 1);
	const end = Date.UTC(year + 1, 0, 1);
	return year + (ms - start) / (end - start);
}

export interface MagneticField {
	/** Declination, degrees east of true north. */
	declination: number;
	/** Inclination (dip), degrees below horizontal. */
	inclination: number;
	/** North, east and down components, nT. */
	x: number;
	y: number;
	z: number;
}

/**
 * The main field at a place and time.
 * @param lat geodetic latitude (what GPS and ADS-B give), degrees
 * @param lon longitude, degrees
 * @param heightKm height above the WGS 84 ellipsoid, km
 * @param year decimal year (see decimalYear)
 */
export function magneticField(
	lat: number,
	lon: number,
	heightKm: number,
	year: number
): MagneticField {
	const rad = Math.PI / 180;
	const phi = lat * rad;
	const lambda = lon * rad;

	// Geodetic (on the ellipsoid) to geocentric spherical coordinates (report eq. 7–8).
	const rc = WGS84_A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
	const p = (rc + heightKm) * Math.cos(phi);
	const zz = (rc * (1 - E2) + heightKm) * Math.sin(phi);
	const r = Math.hypot(p, zz);
	const phiC = Math.asin(zz / r); // geocentric latitude
	const theta = Math.PI / 2 - phiC; // colatitude
	const cosT = Math.cos(theta);
	const sinT = Math.sin(theta);

	// Schmidt semi-normalised Legendre functions P[n][m](cos θ) and their θ-derivatives,
	// by the usual recursions (e.g. Langel 1987):
	//   P(n,n) = √(1 − 1/2n) sin θ P(n−1,n−1)
	//   P(n,m) = ((2n−1) cos θ P(n−1,m) − √((n−1)² − m²) P(n−2,m)) / √(n² − m²)
	const P: number[][] = [];
	const dP: number[][] = [];
	for (let n = 0; n <= N_MAX; n++) {
		P.push(new Array(n + 1).fill(0));
		dP.push(new Array(n + 1).fill(0));
	}
	P[0][0] = 1;
	for (let n = 1; n <= N_MAX; n++) {
		for (let m = 0; m <= n; m++) {
			if (m === n) {
				const k = n === 1 ? 1 : Math.sqrt(1 - 1 / (2 * n));
				P[n][n] = k * sinT * P[n - 1][n - 1];
				dP[n][n] = k * (sinT * dP[n - 1][n - 1] + cosT * P[n - 1][n - 1]);
			} else {
				const k1 = 2 * n - 1;
				const k2 = n >= 2 && m <= n - 2 ? Math.sqrt((n - 1) ** 2 - m ** 2) : 0;
				const prev2 = k2 ? P[n - 2][m] : 0;
				const dPrev2 = k2 ? dP[n - 2][m] : 0;
				const d = Math.sqrt(n ** 2 - m ** 2);
				P[n][m] = (k1 * cosT * P[n - 1][m] - k2 * prev2) / d;
				dP[n][m] = (k1 * (cosT * dP[n - 1][m] - sinT * P[n - 1][m]) - k2 * dPrev2) / d;
			}
		}
	}

	// B = −∇V, in the geocentric frame: north (−B_θ), east (B_λ), down (−B_r).
	const dt = year - MODEL.epoch;
	let xc = 0;
	let yc = 0;
	let zc = 0;
	for (let n = 1; n <= N_MAX; n++) {
		const ratio = (A / r) ** (n + 2);
		for (let m = 0; m <= n; m++) {
			const g = MODEL.g[n][m] + dt * MODEL.gDot[n][m];
			const h = MODEL.h[n][m] + dt * MODEL.hDot[n][m];
			const cosM = Math.cos(m * lambda);
			const sinM = Math.sin(m * lambda);
			xc += ratio * (g * cosM + h * sinM) * dP[n][m];
			yc += (ratio * m * (g * sinM - h * cosM) * P[n][m]) / sinT;
			zc -= ratio * (n + 1) * (g * cosM + h * sinM) * P[n][m];
		}
	}

	// Back to the geodetic frame: tilt north/down by the difference between the latitudes
	// (report eq. 17). East is the same in both.
	const psi = phiC - phi;
	const x = xc * Math.cos(psi) - zc * Math.sin(psi);
	const z = xc * Math.sin(psi) + zc * Math.cos(psi);
	return {
		declination: Math.atan2(yc, x) / rad,
		inclination: Math.atan2(z, Math.hypot(x, yc)) / rad,
		x,
		y: yc,
		z
	};
}

/** Declination at a place and time, degrees east. Height in feet (above the ellipsoid). */
export function declination(lat: number, lon: number, heightFt: number, ms: number): number {
	return magneticField(lat, lon, (heightFt * FT) / 1000, decimalYear(ms)).declination;
}
