<!--
	The wind triangle of one observation, drawn to scale with north up.

	The wind is small next to the speeds (50 kt against 450), so the full triangle is a thin
	sliver. The main view zooms in on where the two long vectors end: the air vector's tip
	(where the aircraft would be after an hour without wind) and the ground vector's tip
	(where it really is). The wind is the arrow between them. The inset shows the whole
	triangle at true scale, with the zoomed area marked. Dashed: the wind split along the
	aircraft's heading (tailwind or headwind) and across it (crosswind).
-->
<script lang="ts">
	import type { WindResult } from '#lib/weather/observation.ts';
	import { toVector, type Vector } from '#lib/weather/wind.ts';

	let { result }: { result: WindResult } = $props();

	const SIZE = 280;
	const INSET = 84;
	const GRID_KT = 10;

	/** Half the zoomed view's width, kt: the wind plus a margin, at least ±25 kt. */
	let half = $derived(Math.max(result.wind.speed * 0.65, 15) + 10);
	let center = $derived({
		north: (result.air.north + result.ground.north) / 2,
		east: (result.air.east + result.ground.east) / 2
	});
	let scale = $derived(SIZE / (2 * half));

	/** kt (north/east) to pixels in the zoomed view. */
	const px = (v: Vector) => ({
		x: SIZE / 2 + (v.east - center.east) * scale,
		y: SIZE / 2 - (v.north - center.north) * scale
	});

	let origin = $derived(px({ north: 0, east: 0 }));
	let airTip = $derived(px(result.air));
	let groundTip = $derived(px(result.ground));
	/** The corner of the components: from the air vector's tip, the tailwind along the heading. */
	let corner = $derived.by(() => {
		const along = toVector(result.components.tailwind, result.trueHeading);
		return px({ north: result.air.north + along.north, east: result.air.east + along.east });
	});

	/** Grid lines every 10 kt, in pixels. */
	let grid = $derived.by(() => {
		const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
		const from = (c: number) => Math.ceil((c - half) / GRID_KT) * GRID_KT;
		for (let e = from(center.east); e <= center.east + half; e += GRID_KT) {
			const x = px({ north: 0, east: e }).x;
			lines.push({ x1: x, y1: 0, x2: x, y2: SIZE });
		}
		for (let n = from(center.north); n <= center.north + half; n += GRID_KT) {
			const y = px({ north: n, east: 0 }).y;
			lines.push({ x1: 0, y1: y, x2: SIZE, y2: y });
		}
		return lines;
	});

	/** An arrowhead at `tip`, pointing away from `from`. */
	function head(from: { x: number; y: number }, tip: { x: number; y: number }, size = 9) {
		const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
		const corner = (da: number) =>
			`${tip.x - size * Math.cos(angle + da)},${tip.y - size * Math.sin(angle + da)}`;
		return `${tip.x},${tip.y} ${corner(0.4)} ${corner(-0.4)}`;
	}

	// The inset: origin in the middle, the longer vector 38 px long.
	let insetScale = $derived(
		38 /
			Math.max(
				Math.hypot(result.air.north, result.air.east),
				Math.hypot(result.ground.north, result.ground.east)
			)
	);
	const ipx = (v: Vector) => ({
		x: INSET / 2 + v.east * insetScale,
		y: INSET / 2 - v.north * insetScale
	});
	let zoomBox = $derived({ ...ipx(center), r: Math.max(half * insetScale, 2) });
</script>

<svg
	viewBox="0 0 {SIZE} {SIZE}"
	class="h-auto w-full max-w-60 shrink-0 overflow-hidden rounded bg-zinc-950"
	role="img"
	aria-label="Wind triangle: the wind is the arrow from the tip of the air vector to the tip of the ground vector"
>
	{#each grid as l, i (i)}
		<line {...l} class="stroke-zinc-800" stroke-width="1" />
	{/each}

	<!-- The two long vectors, coming in from the origin far off-screen. -->
	<line
		x1={origin.x}
		y1={origin.y}
		x2={airTip.x}
		y2={airTip.y}
		class="stroke-sky-400"
		stroke-width="2"
	/>
	<polygon points={head(origin, airTip)} class="fill-sky-400" />
	<line
		x1={origin.x}
		y1={origin.y}
		x2={groundTip.x}
		y2={groundTip.y}
		class="stroke-amber-400"
		stroke-width="2"
	/>
	<polygon points={head(origin, groundTip)} class="fill-amber-400" />

	<!-- The wind split into tailwind (along the heading) and crosswind (across it). -->
	<polyline
		points="{airTip.x},{airTip.y} {corner.x},{corner.y} {groundTip.x},{groundTip.y}"
		class="fill-none stroke-zinc-400"
		stroke-width="1"
		stroke-dasharray="3 3"
	/>

	<!-- The wind: from the air vector's tip to the ground vector's tip. -->
	{#if result.wind.speed > 0.5}
		<line
			x1={airTip.x}
			y1={airTip.y}
			x2={groundTip.x}
			y2={groundTip.y}
			class="stroke-emerald-400"
			stroke-width="3"
		/>
		<polygon points={head(airTip, groundTip, 12)} class="fill-emerald-400" />
	{/if}

	<!-- North and scale. -->
	<g class="fill-zinc-500 text-[11px]">
		<polygon points="16,8 11,22 21,22" />
		<text x="16" y="34" text-anchor="middle">N</text>
		<text x={SIZE - 8} y={SIZE - 8} text-anchor="end">grid {GRID_KT} kt</text>
	</g>

	<!-- Inset: the whole triangle at true scale. -->
	<g transform="translate({SIZE - INSET - 6} 6)">
		<rect width={INSET} height={INSET} rx="4" class="fill-zinc-900 stroke-zinc-700" />
		<line
			x1={INSET / 2}
			y1={INSET / 2}
			x2={ipx(result.air).x}
			y2={ipx(result.air).y}
			class="stroke-sky-400"
			stroke-width="1.5"
		/>
		<line
			x1={INSET / 2}
			y1={INSET / 2}
			x2={ipx(result.ground).x}
			y2={ipx(result.ground).y}
			class="stroke-amber-400"
			stroke-width="1.5"
		/>
		<circle cx={INSET / 2} cy={INSET / 2} r="2" class="fill-zinc-400" />
		<rect
			x={zoomBox.x - zoomBox.r}
			y={zoomBox.y - zoomBox.r}
			width={2 * zoomBox.r}
			height={2 * zoomBox.r}
			class="fill-none stroke-zinc-300"
		/>
		<text x="4" y={INSET - 4} class="fill-zinc-500 text-[9px]">true scale</text>
	</g>
</svg>
