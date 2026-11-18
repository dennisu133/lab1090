/**
 * Wind barbs for the tracker map: the winds the aircraft measured (lib/weather: the wind
 * triangle from registers 5,0 and 6,0, or a turn), drawn where they were measured.
 *
 * A wind barb is the weather map's symbol for wind (WMO Manual on Codes, WMO-No. 306; the
 * same on every aviation wind chart). A staff points from where the wind was measured
 * towards where it comes *from*, and feathers at the outer end give the speed, rounded to
 * 5 kt:
 *
 *        ◣ pennant  50 kt
 *        ─ barb     10 kt     "65 kt from the north":   ◣─╴
 *        ╴ half      5 kt                               │
 *                                                       │
 *                                                       ● where it was measured
 *
 * The feathers go on the clockwise side of the staff in the northern hemisphere and on the
 * other side in the southern one. That's where the low pressure is: the wind blows along
 * the isobars (geostrophic.ts), with the low on its left in the north (Buys Ballot's law).
 * A calm is a circle instead.
 *
 * One barb per aircraft and minute: the mean of that minute's samples (sky.ts keeps one
 * per aircraft every 10 s), at the middle one's position. At 450 kt that's a barb every
 * 14 km along each path; where they would overlap on screen, MapLibre leaves out the
 * older ones. Over the last half hour (sky.ts WINDOW_MS), fading with age, coloured by
 * altitude like the trails: at FL350 and FL390 over the same spot the wind can differ by
 * 20 kt.
 *
 * Pure functions: the drawing is in icons.ts, the layer in TrackerMap.svelte.
 */
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { HeadingCheck } from '#lib/weather/headings.ts';
import type { WindSample } from '#lib/weather/profile.ts';
import { WINDOW_MS } from '#lib/weather/sky.ts';
import { meanVector, windOf } from '#lib/weather/wind.ts';

/** One barb per aircraft and this long. */
export const BARB_BIN_MS = 60_000;
/** Barbs fade out over this long: as long as samples are kept. */
export const BARB_FADE_MS = WINDOW_MS;

export interface BarbProperties {
	/** The aircraft that measured it. */
	icao: string;
	/** The image (barbIcon). */
	icon: string;
	/** Where the wind comes from, true, degrees: the staff points there. */
	direction: number;
	/** kt, not rounded. */
	speed: number;
	/** Mean pressure altitude, ft; `ground` for the shared colour expression. */
	altitude: number;
	ground: false;
	/** How many samples went into it. */
	samples: number;
	from: WindSample['from'];
	/** The heading correction applied to it (headings.ts), degrees; 0: none. */
	corrected: number;
	/** The newest sample's time, ms. */
	rx: number;
	/** 1 when new, falling to 0.3 at BARB_FADE_MS. */
	opacity: number;
	/** Placed first where barbs collide: the newest. */
	sort: number;
}

/**
 * The barbs, from the wind samples (with the heading corrections already applied) and the
 * heading checks (to say which were corrected). Samples without a position are left out.
 */
export function barbFeatures(
	winds: WindSample[],
	checks: Map<string, HeadingCheck>,
	now: number
): FeatureCollection<Point, BarbProperties> {
	const bins = Map.groupBy(
		winds.filter((w) => w.at !== null && now - w.rx <= BARB_FADE_MS),
		(w) => `${w.icao} ${w.from} ${Math.floor(w.rx / BARB_BIN_MS)}`
	);
	const features: Feature<Point, BarbProperties>[] = [];
	for (const [key, samples] of bins) {
		const n = samples.length;
		const wind = windOf(meanVector(samples.map((w) => w.wind))!);
		const middle = samples[Math.floor(n / 2)].at!;
		const { icao, from } = samples[0];
		const rx = Math.max(...samples.map((w) => w.rx));
		const age = Math.max(0, now - rx);
		const check = checks.get(icao);
		features.push({
			type: 'Feature',
			id: key,
			geometry: { type: 'Point', coordinates: [middle.lon, middle.lat] },
			properties: {
				icao,
				icon: barbIcon(wind.speed, middle.lat),
				direction: wind.direction,
				speed: wind.speed,
				altitude: samples.reduce((s, w) => s + w.altitude, 0) / n,
				ground: false,
				samples: n,
				from,
				corrected: from === '5,0/6,0' && check?.significant ? check.correction : 0,
				rx,
				opacity: 1 - 0.7 * Math.min(1, age / BARB_FADE_MS),
				sort: age
			}
		});
	}
	return { type: 'FeatureCollection', features };
}

/** The feathers for a speed: rounded to 5 kt, as many pennants as fit, then barbs, a half. */
export function barbParts(kt: number): {
	knots: number;
	pennants: number;
	barbs: number;
	half: boolean;
} {
	const knots = Math.round(kt / 5) * 5;
	return {
		knots,
		pennants: Math.floor(knots / 50),
		barbs: Math.floor((knots % 50) / 10),
		half: knots % 10 === 5
	};
}

/** The image's name: speed rounded to 5 kt and the hemisphere ("barb-n-65"). */
export function barbIcon(kt: number, lat: number): string {
	return `barb-${lat < 0 ? 's' : 'n'}-${barbParts(kt).knots}`;
}

/** Back from the name: what icons.ts should draw; null if it isn't a barb's. */
export function parseBarbIcon(name: string): { knots: number; south: boolean } | null {
	const m = /^barb-([ns])-(\d+)$/.exec(name);
	return m ? { knots: Number(m[2]), south: m[1] === 's' } : null;
}

/** Image size, px (drawn at twice the CSS size): the barb plus room for the halo. */
export const BARB_WIDTH = 60;
/** Room around the shape for the distance field (icons.ts RADIUS). */
export const BARB_MARGIN = 8;
/** A calm's ring, px. */
export const CALM_RADIUS = 6;
/**
 * Image px below the station: the margin, and room for a calm's ring. TrackerMap moves the
 * image down by this (in CSS px: half) so the station sits on the point.
 */
export const BARB_BELOW = BARB_MARGIN + CALM_RADIUS;
/** Staff length, px: 32 CSS px, longer if the feathers need it. */
const STAFF = 64;
const FEATHER = { length: 20, rise: 7, gap: 9 };
const PENNANT_BASE = 13;

export interface BarbShape {
	width: number;
	height: number;
	/** Staff and feathers, as lines [x1, y1, x2, y2]. */
	lines: [number, number, number, number][];
	/** Pennants, as triangles. */
	triangles: [number, number][][];
	/** The dot where it was measured; for a calm, a ring around it instead of a staff. */
	station: { x: number; y: number; calm: boolean };
}

/**
 * The barb pointing up (a wind from the north), the station at the bottom centre:
 * TrackerMap rotates it by the direction around that point. Image px, y down.
 */
export function barbShape(knots: number, south: boolean): BarbShape {
	const { pennants, barbs, half } = barbParts(knots);
	const x = BARB_WIDTH / 2;
	const side = south ? -1 : 1;
	// From the tip down: pennants, barbs, then the half. A lone half sits one gap in from
	// the tip, so that 5 kt can't be read as 10 (WMO-No. 306).
	const needed =
		pennants * (PENNANT_BASE + 3) + barbs * FEATHER.gap + (half ? FEATHER.gap : 0) + FEATHER.gap;
	const staff = Math.max(STAFF, needed + 3 * FEATHER.gap);
	const height = BARB_MARGIN + FEATHER.rise + staff + BARB_BELOW;
	const bottom = height - BARB_BELOW;
	const tip = bottom - staff;
	const shape: BarbShape = {
		width: BARB_WIDTH,
		height,
		lines: [],
		triangles: [],
		station: { x, y: bottom, calm: knots === 0 }
	};
	if (knots === 0) return shape;
	shape.lines.push([x, bottom, x, tip]);
	let y = tip;
	for (let i = 0; i < pennants; i++) {
		shape.triangles.push([
			[x, y],
			[x + side * FEATHER.length, y - FEATHER.rise],
			[x, y + PENNANT_BASE]
		]);
		y += PENNANT_BASE + 3;
	}
	for (let i = 0; i < barbs; i++) {
		shape.lines.push([x, y, x + side * FEATHER.length, y - FEATHER.rise]);
		y += FEATHER.gap;
	}
	if (half) {
		if (pennants === 0 && barbs === 0) y += FEATHER.gap;
		shape.lines.push([x, y, x + (side * FEATHER.length) / 2, y - FEATHER.rise / 2]);
	}
	return shape;
}
