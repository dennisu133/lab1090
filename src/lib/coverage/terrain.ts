/**
 * The terrain's skyline: per direction, how high the ground rises above the antenna's
 * horizontal, as seen from the antenna (in degrees, like the coverage's skyline). Anything
 * below it is hidden by hills, whatever the receiver.
 *
 * Traced over a digital elevation model: the Terrain Tiles on AWS (Mapzen's "terrarium"
 * PNGs, the same the map's hillshading uses; mostly SRTM at ~30–90 m, see
 * https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Each pixel's colour is
 * a height: R·256 + G + B/256 − 32768 metres. Bare earth: no buildings, no trees. So where
 * the coverage's skyline stands well above this one, something near the antenna blocks the
 * view: a wall, a roof, the building it's mounted on.
 *
 * Along each direction, the highest angle over all points out to MAX_KM:
 * atan((h_ground − h_antenna − d²/2R') / d) (geometry.ts). Beyond ~150 km the Earth's curve
 * hides even mountains: at 150 km the drop is 1.3 km, so a ridge would have to stand more
 * than that above the antenna to show.
 */
import { destination } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { elevationAngle } from './geometry';

/** Ground height in metres above sea level at a point; null: unknown (tile missing). */
export type ElevationAt = (p: LatLon) => number | null;

/** How far the skyline is traced, km. */
export const MAX_KM = 150;
/**
 * The antenna above the ground it stands on, m: a guess (a balcony, a roof). The coverage
 * can't tell, and it barely matters for the angles: 10 m moves an aircraft 30 km away by
 * 0.02°. What it changes is which nearby ground is below the horizontal.
 */
export const ANTENNA_ABOVE_GROUND_M = 10;

/** Directions traced, one per this many degrees. */
export const SKYLINE_STEP_DEG = 1;

/**
 * The terrain skyline: one angle per SKYLINE_STEP_DEG from north, clockwise, degrees.
 * `antennaKm`: the antenna's height above sea level. Steps grow with the distance (finer
 * near the antenna, where a small rise means a large angle).
 */
export function terrainSkyline(receiver: LatLon, antennaKm: number, at: ElevationAt): number[] {
	const out: number[] = [];
	for (let b = 0; b < 360; b += SKYLINE_STEP_DEG) {
		let highest = -90;
		for (let d = 0.2; d <= MAX_KM; d += Math.max(0.1, d / 40)) {
			const h = at(destination(receiver, b, d));
			if (h === null) continue;
			highest = Math.max(highest, elevationAngle(d, h / 1000, antennaKm));
		}
		out.push(highest);
	}
	return out;
}

/** Height in metres from a terrarium pixel's red, green and blue. */
function terrariumHeight(r: number, g: number, b: number): number {
	return r * 256 + g + b / 256 - 32768;
}

/** Web Mercator tile coordinates (fractional) of a point at zoom z. */
function tileXY(p: LatLon, z: number): { x: number; y: number } {
	const n = 2 ** z;
	const phi = (p.lat * Math.PI) / 180;
	return {
		x: ((p.lon + 180) / 360) * n,
		y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n
	};
}

const TILE = 256;
const URL = (z: number, x: number, y: number) =>
	`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Decoded tiles of one zoom level: heights per pixel, row by row. */
class TileSet {
	#z: number;
	#tiles = new Map<string, Float32Array>();

	constructor(z: number) {
		this.#z = z;
	}

	/** Fetch the tiles covering `radiusKm` around `centre` (browser only: needs a canvas). */
	async load(centre: LatLon, radiusKm: number, signal?: AbortSignal): Promise<void> {
		const corners = [0, 90, 180, 270].map((b) => tileXY(destination(centre, b, radiusKm), this.#z));
		const xs = corners.map((c) => Math.floor(c.x));
		const ys = corners.map((c) => Math.floor(c.y));
		const jobs: Promise<void>[] = [];
		for (let x = Math.min(...xs); x <= Math.max(...xs); x++)
			for (let y = Math.min(...ys); y <= Math.max(...ys); y++) jobs.push(this.#fetch(x, y, signal));
		await Promise.all(jobs);
	}

	async #fetch(x: number, y: number, signal?: AbortSignal): Promise<void> {
		try {
			const res = await fetch(URL(this.#z, x, y), { signal });
			if (!res.ok) return;
			const bitmap = await createImageBitmap(await res.blob());
			const canvas = new OffscreenCanvas(TILE, TILE);
			const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
			ctx.drawImage(bitmap, 0, 0);
			const px = ctx.getImageData(0, 0, TILE, TILE).data;
			const heights = new Float32Array(TILE * TILE);
			for (let i = 0; i < heights.length; i++)
				heights[i] = terrariumHeight(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
			this.#tiles.set(`${x}/${y}`, heights);
		} catch {
			// A tile that won't load leaves a hole: those points are skipped.
		}
	}

	/** The nearest pixel's height; null outside the loaded tiles. */
	at(p: LatLon): number | null {
		const { x, y } = tileXY(p, this.#z);
		const tile = this.#tiles.get(`${Math.floor(x)}/${Math.floor(y)}`);
		if (!tile) return null;
		const px = Math.min(TILE - 1, Math.floor((x % 1) * TILE));
		const py = Math.min(TILE - 1, Math.floor((y % 1) * TILE));
		return tile[py * TILE + px];
	}
}

/** Near the antenna: zoom 11 (~45 m pixels at 52°N), out to NEAR_KM. */
const NEAR = { z: 11, km: 10 };
/** Beyond: zoom 8 (~370 m pixels), out to MAX_KM: about 25 tiles. */
const FAR = { z: 8, km: MAX_KM };

export interface Terrain {
	/** Ground height at the receiver, m (null: unknown). */
	ground: number | null;
	/** The antenna's height above sea level, km: ground + ANTENNA_ABOVE_GROUND_M. */
	antennaKm: number;
	/** terrainSkyline's angles, one per SKYLINE_STEP_DEG. */
	skyline: number[];
}

/** Load the tiles around the receiver and trace the skyline (browser only). */
export async function loadTerrain(receiver: LatLon, signal?: AbortSignal): Promise<Terrain> {
	const near = new TileSet(NEAR.z);
	const far = new TileSet(FAR.z);
	await Promise.all([near.load(receiver, NEAR.km, signal), far.load(receiver, FAR.km, signal)]);
	const at: ElevationAt = (p) => near.at(p) ?? far.at(p);
	const ground = at(receiver);
	const antennaKm = ((ground ?? 0) + ANTENNA_ABOVE_GROUND_M) / 1000;
	return { ground, antennaKm, skyline: terrainSkyline(receiver, antennaKm, at) };
}
