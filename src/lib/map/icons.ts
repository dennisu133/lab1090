/**
 * The aircraft symbols on the map: a few silhouettes, chosen by the emitter category the
 * aircraft broadcasts (TC 1–4, DO-260B Table A-2-8), sized by its weight class. Seen from
 * above, nose up (north): the map rotates them by the ground track.
 *
 * Drawn here, not taken from another tracker (tar1090's shapes are GPL). Each is an SVG path
 * in a 64 × 64 box.
 *
 * MapLibre can only tint an icon per feature (the altitude colour) if it's a signed distance
 * field (SDF): every pixel stores how far it is from the outline, not a colour. The GPU
 * then draws the edge wherever that distance crosses the threshold, sharp at any size, and
 * the halo (a dark outline for contrast) is just a second threshold further out. So each
 * silhouette is drawn once into a canvas and turned into an SDF (sdf() below).
 *
 * The wind barbs (winds.ts) are SDFs too, for the same reason: coloured by altitude. And
 * the radar sites' symbol (radars.ts), for the halo.
 */
import type { EmitterCategory } from '#lib/modes/identification.ts';
import { barbShape, CALM_RADIUS, parseBarbIcon } from './winds';

export type IconName = 'jet' | 'light' | 'glider' | 'helicopter' | 'balloon' | 'vehicle' | 'radar';

const PATHS: Record<IconName, string[]> = {
	// Swept wings and a T-less tail: an airliner.
	jet: [
		'M32 2 C34 2 35 5 35 8 L35 22 L60 36 L60 40 L35 33 L35 50 L43 56 L43 59 L32 56 L21 59 L21 56 L29 50 L29 33 L4 40 L4 36 L29 22 L29 8 C29 5 30 2 32 2 Z'
	],
	// Straight wings: a light piston aircraft.
	light: [
		'M32 6 C34 6 35 9 35 12 L35 22 L60 22 L60 28 L35 28 L35 48 L44 50 L44 55 L32 54 L20 55 L20 50 L29 48 L29 28 L4 28 L4 22 L29 22 L29 12 C29 9 30 6 32 6 Z'
	],
	// Long, narrow wings.
	glider: [
		'M32 10 C33.5 10 34 12 34 14 L34 26 L62 27 L62 30 L34 30 L34 50 L40 52 L40 55 L32 54 L24 55 L24 52 L30 50 L30 30 L2 30 L2 27 L30 26 L30 14 C30 12 30.5 10 32 10 Z'
	],
	// Body, tail boom, tail rotor, and the main rotor's two blades crossed.
	helicopter: [
		'M32 19 A7 11 0 1 0 32 41 A7 11 0 1 0 32 19 Z',
		'M30.5 40 L33.5 40 L33.5 60 L30.5 60 Z',
		'M26 56 L38 56 L38 59 L26 59 Z',
		'M12.54 10.66 L14.66 8.54 L51.46 45.34 L49.34 47.46 Z',
		'M51.46 10.66 L49.34 8.54 L12.54 45.34 L14.66 47.46 Z'
	],
	balloon: ['M32 12 A15 15 0 1 0 32 42 A15 15 0 1 0 32 12 Z', 'M29 47 L35 47 L35 53 L29 53 Z'],
	// A radar site (lib/map/radars.ts), not an aircraft: a secondary radar's antenna, a long
	// horizontal bar (it forms a beam narrow sideways, wide up and down), on its mast.
	radar: [
		'M8 12 L56 12 L56 21 L8 21 Z',
		'M28.5 21 L35.5 21 L40 52 L24 52 Z',
		'M16 52 L48 52 L48 58 L16 58 Z'
	],
	// A rounded box: a car or truck on the apron.
	vehicle: [
		'M24 18 L40 18 A3 3 0 0 1 43 21 L43 43 A3 3 0 0 1 40 46 L24 46 A3 3 0 0 1 21 43 L21 21 A3 3 0 0 1 24 18 Z'
	]
};

/** Icon size on the map, relative (1 = 36 px): by weight class, so a heavy looks heavy. */
const SIZES: Record<string, number> = {
	A1: 0.55, // light (< 7 t)
	A2: 0.65, // small (7–34 t)
	A3: 0.8, // large (34–136 t): most airliners, A320 to A330-ish
	A4: 0.85, // high vortex large (B757)
	A5: 1, // heavy (> 136 t): B777, A350, B747
	A6: 0.7, // high performance (fighters)
	A7: 0.75 // rotorcraft
};

/** Which silhouette, and how big. No category (yet): most traffic here is airliners. */
export function iconFor(category: EmitterCategory | null): { icon: IconName; size: number } {
	const key = category ? `${category.set}${category.code}` : '';
	const icon: IconName =
		key === 'A1' || key === 'B4' || key === 'B6'
			? 'light'
			: key === 'A7'
				? 'helicopter'
				: key === 'B1'
					? 'glider'
					: key === 'B2' || key === 'B3'
						? 'balloon'
						: category?.set === 'C'
							? 'vehicle'
							: 'jet';
	const size = SIZES[key] ?? (icon === 'vehicle' ? 0.45 : icon === 'jet' ? 0.8 : 0.65);
	return { icon, size };
}

/** Canvas size: the 64 × 64 shape plus room for the halo. Drawn at twice the CSS size. */
const SIZE = 72;
const PIXEL_RATIO = 2;
/** How far the distance field reaches, px (as in MapLibre's own glyph SDFs). */
const RADIUS = 8;
/** Where the edge is: MapLibre draws an SDF's shape at 0.75 of the range (alpha 191). */
const CUTOFF = 0.25;

/** Every silhouette as an SDF image, for map.addImage(name, image, { sdf: true, pixelRatio }). */
export function iconImages(): { name: IconName; image: ImageData; pixelRatio: number }[] {
	return (Object.keys(PATHS) as IconName[]).map((name) => ({
		name,
		image: sdf(draw(PATHS[name])),
		pixelRatio: PIXEL_RATIO
	}));
}

function draw(paths: string[]): ImageData {
	const { canvas, ctx } = blank(SIZE, SIZE);
	const offset = (SIZE - 64) / 2;
	ctx.translate(offset, offset);
	for (const d of paths) ctx.fill(new Path2D(d));
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function blank(width: number, height: number) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = ctx.strokeStyle = '#fff';
	return { canvas, ctx };
}

/** Stroke width of a barb's staff and feathers, px (1.5 CSS px). */
const BARB_STROKE = 3;

/**
 * A wind barb's SDF image (lib/map/winds.ts), by its name ("barb-n-65"); null if the name
 * isn't a barb's. Made when the map first needs it (TrackerMap: styleimagemissing): only
 * the speeds that occur, a dozen or so.
 */
export function barbImage(name: string): { image: ImageData; pixelRatio: number } | null {
	const parsed = parseBarbIcon(name);
	if (!parsed) return null;
	const shape = barbShape(parsed.knots, parsed.south);
	const { ctx } = blank(shape.width, shape.height);
	ctx.lineWidth = BARB_STROKE;
	ctx.lineCap = 'round';
	ctx.beginPath();
	for (const [x1, y1, x2, y2] of shape.lines) {
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
	}
	ctx.stroke();
	for (const [first, ...rest] of shape.triangles) {
		ctx.beginPath();
		ctx.moveTo(...first);
		for (const p of rest) ctx.lineTo(...p);
		ctx.closePath();
		ctx.fill();
	}
	const { x, y, calm } = shape.station;
	ctx.beginPath();
	if (calm) {
		ctx.arc(x, y, CALM_RADIUS, 0, 2 * Math.PI);
		ctx.stroke();
	} else {
		ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
		ctx.fill();
	}
	return { image: sdf(ctx.getImageData(0, 0, shape.width, shape.height)), pixelRatio: PIXEL_RATIO };
}

/**
 * Turn a drawn shape (its alpha) into a signed distance field. For each pixel: the distance
 * to the nearest pixel on the other side of the outline, negative inside. Then the same
 * encoding as MapLibre's glyphs: alpha = 255 · (1 − (d / RADIUS + CUTOFF)), so the outline
 * lands at 191, inside rises to 255, outside falls to 0 at 0.75 · RADIUS.
 *
 * Brute force (each pixel looks at its 17 × 17 neighbourhood): 72² · 289 ≈ 1.5 million
 * steps per icon, once per page load. Fine.
 */
function sdf(drawn: ImageData): ImageData {
	const { width, height, data } = drawn;
	const inside = (x: number, y: number) => data[(y * width + x) * 4 + 3] >= 128;
	const out = new ImageData(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const here = inside(x, y);
			let nearest = RADIUS;
			for (let dy = -RADIUS; dy <= RADIUS; dy++) {
				for (let dx = -RADIUS; dx <= RADIUS; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					if (inside(nx, ny) !== here) nearest = Math.min(nearest, Math.hypot(dx, dy));
				}
			}
			// The outline lies between two pixels: half a pixel short of the other side.
			const d = (here ? -1 : 1) * (nearest - 0.5);
			const alpha = 255 * (1 - (d / RADIUS + CUTOFF));
			const i = (y * width + x) * 4;
			out.data[i] = out.data[i + 1] = out.data[i + 2] = 255;
			out.data[i + 3] = Math.max(0, Math.min(255, Math.round(alpha)));
		}
	}
	return out;
}
