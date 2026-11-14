/**
 * The geoid: where mean sea level would be, relative to the WGS84 ellipsoid that GPS
 * measures heights from.
 *
 * GPS describes the Earth as a smooth, slightly flattened ellipsoid (WGS84), and its
 * heights are above that ellipsoid (HAE). Sea level isn't smooth: where there is more
 * mass below (mountains, dense rock) gravity pulls the water up, elsewhere it sags. That
 * surface, sea level extended under the continents, is the geoid. Around Berlin it lies
 * about 40 m above the ellipsoid; south of India 106 m below it.
 *
 *   height above sea level = height above the ellipsoid − geoid undulation (N)
 *
 * This matters for /weather because ADS-B's GNSS height is, per DO-260B, above the
 * ellipsoid (dump1090-fa documents alt_geom the same way), while the hypsometric
 * equation (column.ts) needs heights above sea level.
 *
 * Bilinear interpolation on a 2° grid of EGM96 (egm96.ts, with its accuracy). Shared by
 * server and browser; no state here.
 */
import { EGM96, EGM96_STEP } from './egm96';

const ROWS = 180 / EGM96_STEP + 1;
const COLS = 360 / EGM96_STEP;

/** Parsed on first use: row 0 is 90°N, column 0 is 0°E. */
let grid: Int16Array | null = null;

function load(): Int16Array {
	const values = EGM96.trim().split(/\s+/).map(Number);
	if (values.length !== ROWS * COLS) throw new Error(`EGM96 grid: ${values.length} values`);
	return Int16Array.from(values);
}

/** Geoid undulation N at a position, m: how far sea level is above (+) the WGS84 ellipsoid. */
export function geoidUndulation(lat: number, lon: number): number {
	grid ??= load();
	const g = grid;
	const y = (90 - Math.max(-90, Math.min(90, lat))) / EGM96_STEP;
	const x = (((lon % 360) + 360) % 360) / EGM96_STEP;
	const r = Math.min(Math.floor(y), ROWS - 2);
	const c = Math.floor(x);
	const a = y - r;
	const b = x - c;
	const at = (row: number, col: number) => g[row * COLS + (col % COLS)];
	return (
		(1 - a) * ((1 - b) * at(r, c) + b * at(r, c + 1)) +
		a * ((1 - b) * at(r + 1, c) + b * at(r + 1, c + 1))
	);
}
