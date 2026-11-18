<!--
	Temperature against altitude: the standard atmosphere (dashed) and what this aircraft
	measured, so the deviation from standard is the horizontal gap between them. The hollow
	dot is what the temperature probe itself reads (total air temperature), warmed by the
	air being stopped in front of it.
-->
<script lang="ts">
	import { flightLevel } from '#lib/describe/format.ts';
	import { isaTemperature } from '#lib/modes/air-data.ts';
	import type { TemperatureResult } from '#lib/weather/observation.ts';
	import { H_MAX, LEVELS, celsiusTicks, degrees, isaPolyline } from './profile-chart';

	let { result, altitude }: { result: TemperatureResult; altitude: number | null } = $props();

	/** px: max-w-60, so at full size the viewBox is the element's px and labels stay 10 px. */
	const SIZE = 240;
	const LEFT = 40;
	const BOTTOM = 20;
	const TOP = 8;
	const RIGHT = 8;
	/** Axes: °C and ft. */
	const T_MIN = -70;
	const T_MAX = 30;

	const x = (kelvin: number) =>
		LEFT + ((kelvin - 273.15 - T_MIN) / (T_MAX - T_MIN)) * (SIZE - LEFT - RIGHT);
	const y = (feet: number) =>
		SIZE - BOTTOM - (Math.min(feet, H_MAX) / H_MAX) * (SIZE - BOTTOM - TOP);

	const isa = isaPolyline(x, y);
	const temperatures = celsiusTicks(-60, 20, 20);

	let at = $derived(result.atAltitude);
	let warmer = $derived((at?.isaDeviation ?? 0) >= 0);
</script>

<svg
	viewBox="0 0 {SIZE} {SIZE}"
	class="h-auto w-full max-w-60 shrink-0 rounded bg-zinc-950"
	role="img"
	aria-label="Temperature against altitude: the standard atmosphere, and the temperature this aircraft measured"
>
	<!-- Grid and labels. -->
	<g class="fill-zinc-500 text-[10px]">
		{#each temperatures as c (c)}
			<line
				x1={x(c + 273.15)}
				y1={TOP}
				x2={x(c + 273.15)}
				y2={SIZE - BOTTOM}
				class="stroke-zinc-800"
			/>
			<text x={x(c + 273.15)} y={SIZE - 6} text-anchor="middle">{degrees(c)}</text>
		{/each}
		{#each LEVELS as h (h)}
			<line x1={LEFT} y1={y(h)} x2={SIZE - RIGHT} y2={y(h)} class="stroke-zinc-800" />
			<text x={LEFT - 4} y={y(h) + 3} text-anchor="end">{flightLevel(h)}</text>
		{/each}
	</g>

	<!-- The standard atmosphere. -->
	<polyline
		points={isa}
		class="fill-none stroke-zinc-400"
		stroke-width="1.5"
		stroke-dasharray="4 3"
	/>
	<!-- Labelled beside the line at FL150, on its warm side. -->
	<text x={x(isaTemperature(15_000)) + 6} y={y(15_000)} class="fill-zinc-400 text-[10px]">
		ISA
	</text>

	{#if at && altitude !== null}
		{@const yy = y(altitude)}
		<!-- The deviation: from the standard to the measured temperature. -->
		<line
			x1={x(at.isa)}
			y1={yy}
			x2={x(result.kelvin)}
			y2={yy}
			class={warmer ? 'stroke-rose-400' : 'stroke-sky-400'}
			stroke-width="3"
		/>
		<!-- What the probe reads, warmed by stopping the air. -->
		<line
			x1={x(result.kelvin)}
			y1={yy}
			x2={x(result.total)}
			y2={yy}
			class="stroke-amber-400/60"
			stroke-width="1"
			stroke-dasharray="2 2"
		/>
		<circle
			cx={x(result.total)}
			cy={yy}
			r="4"
			class="fill-none stroke-amber-400"
			stroke-width="1.5"
		/>
		<!-- Measured, with what the rounding allows. -->
		<line
			x1={x(result.range[0])}
			y1={yy - 5}
			x2={x(result.range[0])}
			y2={yy + 5}
			class="stroke-zinc-300"
		/>
		<line
			x1={x(result.range[1])}
			y1={yy - 5}
			x2={x(result.range[1])}
			y2={yy + 5}
			class="stroke-zinc-300"
		/>
		<circle cx={x(result.kelvin)} cy={yy} r="4" class="fill-zinc-100" />
	{:else}
		<text
			x={SIZE / 2 + LEFT / 2}
			y={SIZE / 2}
			text-anchor="middle"
			class="fill-zinc-500 text-[11px]"
		>
			no altitude
		</text>
	{/if}
</svg>
