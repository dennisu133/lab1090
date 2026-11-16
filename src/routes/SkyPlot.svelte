<!--
	The antenna's sky, seen from below: direction around (north up, east right, as on a map),
	elevation angle from the horizon at the edge to straight overhead in the middle. Each dot is
	a position (thinned), coloured by altitude like the tracker. The lighter area is the sky
	aircraft were heard in: per sector, from overhead down to the lowest one. Whatever it
	leaves dark was never heard: blocked, or no traffic there yet. The dashed line is the
	terrain's own skyline (terrain.ts); at the edge where the land is flat.

	The radius isn't linear in the angle: r ∝ 1 − √(e/90°). The few degrees above the horizon
	are where the coverage is decided, and a linear scale would squeeze 0–20° into the outer
	fifth. The rings are labelled.

	Tap (or use the arrow keys) to pick a sector: its numbers show below the plot, its wedge
	on the map.
-->
<script lang="ts">
	import { SECTOR_DEG, type CoveragePoint, type Sector } from '#lib/coverage/coverage.ts';
	import { SKYLINE_STEP_DEG } from '#lib/coverage/terrain.ts';
	import { altitudeCss } from '#lib/map/altitude.ts';

	interface Props {
		sectors: Sector[];
		points: CoveragePoint[];
		/** terrain.ts's skyline (degrees per SKYLINE_STEP_DEG); null: not loaded. */
		terrain: number[] | null;
		/** The selected sector's index; null: none. */
		selected: number | null;
		onselect: (index: number | null) => void;
	}

	let { sectors, points, terrain, selected, onselect }: Props = $props();

	/** The viewBox is SIZE × SIZE; the horizon circle has radius R. */
	const SIZE = 360;
	const C = SIZE / 2;
	const R = 160;
	const RINGS = [0, 5, 15, 30, 60];
	const SECTORS = 360 / SECTOR_DEG;

	/** Radius for an elevation angle, degrees: 0° at the edge, 90° in the middle. */
	const radius = (e: number) => R * (1 - Math.sqrt(Math.min(Math.max(e, 0), 90) / 90));
	const xy = (bearing: number, r: number): [number, number] => {
		const a = (bearing * Math.PI) / 180;
		return [C + r * Math.sin(a), C - r * Math.cos(a)];
	};
	const f = (n: number) => n.toFixed(1);

	/** The heard sky: per sector, a wedge from the middle out to its lowest position. */
	let heard = $derived(
		sectors
			.filter((s) => s.lowest)
			.map((s) => {
				const r = radius(s.lowest!.elevation);
				const [x1, y1] = xy(s.from, r);
				const [x2, y2] = xy(s.from + SECTOR_DEG, r);
				return `M${C},${C}L${f(x1)},${f(y1)}A${f(r)},${f(r)} 0 0 1 ${f(x2)},${f(y2)}Z`;
			})
			.join('')
	);

	let terrainPath = $derived(
		terrain
			? terrain
					.map((e, i) => xy(i * SKYLINE_STEP_DEG, radius(e)))
					.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`)
					.join('') + 'Z'
			: ''
	);

	let selectedPath = $derived.by(() => {
		if (selected === null) return '';
		const from = selected * SECTOR_DEG;
		const [x1, y1] = xy(from, R);
		const [x2, y2] = xy(from + SECTOR_DEG, R);
		return `M${C},${C}L${f(x1)},${f(y1)}A${R},${R} 0 0 1 ${f(x2)},${f(y2)}Z`;
	});

	/** The dots, on a canvas over the SVG (thousands of them). Redrawn when `points` changes. */
	function dots(canvas: HTMLCanvasElement) {
		const scale = window.devicePixelRatio || 1;
		const px = canvas.clientWidth * scale;
		canvas.width = px;
		canvas.height = px;
		const ctx = canvas.getContext('2d')!;
		const k = px / SIZE;
		for (const p of points) {
			const [x, y] = xy(p.bearing, radius(p.elevation));
			ctx.fillStyle = altitudeCss(p.altitude);
			ctx.beginPath();
			ctx.arc(x * k, y * k, 1.2 * k, 0, 2 * Math.PI);
			ctx.fill();
		}
	}

	/** The sector under the pointer; outside the horizon circle: none. */
	function pick(e: MouseEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = ((e.clientX - box.left) / box.width) * SIZE - C;
		const y = ((e.clientY - box.top) / box.height) * SIZE - C;
		if (Math.hypot(x, y) > R + 8) return onselect(null);
		const bearing = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
		const i = Math.floor(bearing / SECTOR_DEG);
		onselect(i === selected ? null : i);
	}

	function step(e: KeyboardEvent) {
		const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
		if (by !== undefined) {
			e.preventDefault();
			onselect(((((selected ?? (by > 0 ? -1 : 0)) + by) % SECTORS) + SECTORS) % SECTORS);
		} else if (e.key === 'Escape') onselect(null);
	}
</script>

<button
	type="button"
	class="relative block aspect-square w-full max-w-90 cursor-crosshair rounded-full focus-visible:outline-2 focus-visible:outline-zinc-400"
	aria-label="Sky plot. Tap a direction for its numbers; the arrow keys step through the {SECTOR_DEG}° sectors."
	onclick={pick}
	onkeydown={step}
>
	<svg viewBox="0 0 {SIZE} {SIZE}" class="absolute inset-0 h-full w-full" aria-hidden="true">
		<circle cx={C} cy={C} r={R} class="fill-zinc-950 stroke-zinc-700" />
		<path d={heard} class="fill-zinc-800/70" />
		{#each RINGS.slice(1) as e (e)}
			<circle
				cx={C}
				cy={C}
				r={radius(e)}
				class="fill-none stroke-zinc-700/70"
				stroke-dasharray="2 3"
			/>
			<text x={C + 3} y={C - radius(e) + 10} class="fill-zinc-500 text-[9px]">{e}°</text>
		{/each}
		<text x={C + 3} y={C - R + 10} class="fill-zinc-500 text-[9px]">0°</text>
		{#each [0, 90, 180, 270] as b (b)}
			{@const [x1, y1] = xy(b, 0)}
			{@const [x2, y2] = xy(b, R)}
			<line {x1} {y1} {x2} {y2} class="stroke-zinc-800" />
		{/each}
		{#each [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const as [label, b] (label)}
			{@const [x, y] = xy(b, R + 11)}
			<text
				{x}
				{y}
				text-anchor="middle"
				dominant-baseline="central"
				class="fill-zinc-400 text-[11px]">{label}</text
			>
		{/each}
		{#if terrainPath}
			<path d={terrainPath} class="fill-none stroke-amber-300/70" stroke-dasharray="3 2" />
		{/if}
		{#if selectedPath}
			<path d={selectedPath} class="fill-zinc-100/10 stroke-zinc-100/60" />
		{/if}
	</svg>
	<canvas class="pointer-events-none absolute inset-0 h-full w-full" {@attach dots}></canvas>
</button>
