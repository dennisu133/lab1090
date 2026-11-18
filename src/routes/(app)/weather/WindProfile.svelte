<!--
	Wind speed against altitude, layer by layer, with an arrow for where the air blows to
	(up on the page is north). The dashed line is the jet stream threshold (30 m/s); the
	strongest layer is highlighted. Hollow dots have fewer than MIN_SAMPLES samples or come
	from one aircraft only.
-->
<script lang="ts">
	import { directionText, flightLevel } from '#lib/describe/format.ts';
	import { JET_KT, enough, type Layer, type StrongestWind } from '#lib/weather/profile.ts';
	import { BOTTOM, H, LEFT, LEVELS, RIGHT, TOP, chartWidth, xAxis, y } from './profile-chart';

	let { layers, strongest }: { layers: Layer[]; strongest: StrongestWind | null } = $props();

	/** The viewBox is the chart's width in px, so the labels keep their size. */
	let width = $state(0);
	let W = $derived(chartWidth(width));

	/** Arrow length, px. */
	const ARROW = 16;

	let measured = $derived(layers.filter((l) => l.wind));
	/** At least 120 kt, in steps of 40 kt, so the fastest layer fits. */
	let max = $derived(
		Math.max(120, Math.ceil(Math.max(...measured.map((l) => l.wind!.wind.speed)) / 40) * 40)
	);
	let x = $derived(xAxis(0, max, W));
	let speeds = $derived(Array.from({ length: max / 40 + 1 }, (_, i) => i * 40));
</script>

<div class="w-full" bind:clientWidth={width}>
	<svg
		viewBox="0 0 {W} {H}"
		class="h-auto w-full rounded bg-zinc-950"
		role="img"
		aria-label="Wind speed and direction against altitude, per 1,000 ft layer"
	>
		<defs>
			<marker
				id="wind-arrow"
				viewBox="0 0 6 6"
				refX="5"
				refY="3"
				markerWidth="5"
				markerHeight="5"
				orient="auto"
			>
				<path d="M0,0 L6,3 L0,6 z" class="fill-emerald-300" />
			</marker>
		</defs>
		<g class="fill-zinc-500 text-[10px]">
			{#each speeds as kt (kt)}
				<line x1={x(kt)} y1={TOP} x2={x(kt)} y2={H - BOTTOM} class="stroke-zinc-800" />
				<text x={x(kt)} y={H - BOTTOM + 12} text-anchor="middle">{kt}</text>
			{/each}
			{#each LEVELS as h (h)}
				<line x1={LEFT} y1={y(h)} x2={W - RIGHT} y2={y(h)} class="stroke-zinc-800" />
				<text x={LEFT - 4} y={y(h) + 3} text-anchor="end">{flightLevel(h)}</text>
			{/each}
			<text x={(LEFT + W - RIGHT) / 2} y={H - 4} text-anchor="middle">wind speed, kt</text>
		</g>

		<line
			x1={x(JET_KT)}
			y1={TOP}
			x2={x(JET_KT)}
			y2={H - BOTTOM}
			class="stroke-sky-400/70"
			stroke-dasharray="4 3"
		/>
		<text x={x(JET_KT) + 4} y={TOP + 8} class="fill-sky-300 text-[10px]">jet stream →</text>

		{#each measured as l (l.level)}
			{@const w = l.wind!}
			{@const cx = x(w.wind.speed)}
			{@const cy = y(l.level)}
			{@const top = strongest?.level === l.level}
			{@const len = Math.max(w.wind.speed, 1)}
			<line
				x1={cx}
				y1={cy}
				x2={cx + (ARROW * w.wind.vector.east) / len}
				y2={cy - (ARROW * w.wind.vector.north) / len}
				class="stroke-emerald-300/80"
				marker-end="url(#wind-arrow)"
			/>
			<circle
				{cx}
				{cy}
				r={top ? 4.5 : 3}
				class={enough(w)
					? top
						? 'fill-emerald-300 stroke-white'
						: 'fill-emerald-300'
					: 'fill-zinc-950 stroke-emerald-300'}
			>
				<title>
					{`${flightLevel(l.level)}: from ${directionText(w.wind.direction)} at ${Math.round(w.wind.speed)} kt, ${w.n} samples`}
				</title>
			</circle>
		{/each}

		{#if measured.length === 0}
			<text x={(LEFT + W) / 2} y={H / 2} text-anchor="middle" class="fill-zinc-500 text-[11px]">
				no winds yet
			</text>
		{/if}
	</svg>
</div>
