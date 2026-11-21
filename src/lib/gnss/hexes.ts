/**
 * A grid of hexagons over the receiver's sky, to count aircraft by place: every position
 * falls in exactly one cell, and the cells tile the map without gaps. Hexagons rather than
 * squares because every neighbour is the same distance away (a square's diagonal ones are
 * 41 % further), so no direction is favoured.
 *
 * The grid lies flat on an equirectangular projection centred on the receiver: x east and
 * y north, in km, x = R · Δλ · cos φ₀, y = R · Δφ. Within the 500 km anything can be heard
 * that's close enough: 500 km north the true east–west scale is cos 56.5° / cos 52° ≈ 0.9 of
 * the projection's at 52°N, so cells there come out 10 % narrower on the ground than
 * near the receiver. They are still cells, which is all the counting needs.
 *
 * Pointy-top hexagons in axial coordinates (q, r), rounded through cube coordinates, as Red
 * Blob Games lays them out ("Hexagonal Grids", Amit Patel, 2013).
 *
 * Shared by server and browser; no state but the origin.
 */
import type { LatLon } from '#lib/modes/cpr.ts';

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;
const SQRT3 = Math.sqrt(3);

export class HexGrid {
	readonly origin: LatLon;
	/** Centre to corner, km (also the length of a side). */
	readonly size: number;
	#kmPerLon: number;
	#kmPerLat = EARTH_RADIUS_KM * DEG;

	constructor(origin: LatLon, sizeKm: number) {
		this.origin = origin;
		this.size = sizeKm;
		this.#kmPerLon = EARTH_RADIUS_KM * DEG * Math.cos(origin.lat * DEG);
	}

	/** The cell a position falls in: "q,r". */
	key(p: LatLon): string {
		const x = (p.lon - this.origin.lon) * this.#kmPerLon;
		const y = (p.lat - this.origin.lat) * this.#kmPerLat;
		const q = ((SQRT3 / 3) * x - y / 3) / this.size;
		const r = ((2 / 3) * y) / this.size;
		// Cube rounding: round all three (q + r + s = 0), then fix the one rounded furthest.
		const s = -q - r;
		let [rq, rr] = [Math.round(q), Math.round(r)];
		const rs = Math.round(s);
		const [dq, dr, ds] = [Math.abs(rq - q), Math.abs(rr - r), Math.abs(rs - s)];
		if (dq > dr && dq > ds) rq = -rr - rs;
		else if (dr > ds) rr = -rq - rs;
		// +0 turns -0 into 0, so a cell has one key.
		return `${rq + 0},${rr + 0}`;
	}

	/** The cell's centre. */
	center(key: string): LatLon {
		const [q, r] = key.split(',').map(Number);
		return this.#toLatLon(this.size * (SQRT3 * q + (SQRT3 / 2) * r), this.size * 1.5 * r);
	}

	/** The cell's outline as a closed ring of [lon, lat] (GeoJSON's order), from the top corner clockwise. */
	ring(key: string): [number, number][] {
		const [q, r] = key.split(',').map(Number);
		const cx = this.size * (SQRT3 * q + (SQRT3 / 2) * r);
		const cy = this.size * 1.5 * r;
		return Array.from({ length: 7 }, (_, i) => {
			const angle = (90 - 60 * (i % 6)) * DEG;
			const p = this.#toLatLon(cx + this.size * Math.cos(angle), cy + this.size * Math.sin(angle));
			return [p.lon, p.lat];
		});
	}

	#toLatLon(x: number, y: number): LatLon {
		return { lat: this.origin.lat + y / this.#kmPerLat, lon: this.origin.lon + x / this.#kmPerLon };
	}
}
