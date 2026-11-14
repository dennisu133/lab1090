<!--
	Temperature against altitude, layer by layer: what a weather balloon would draw. The
	dashed line is the standard atmosphere; where the measured dots stop moving left (no
	longer getting colder) is the tropopause. Hollow dots have fewer than MIN_SAMPLES
	samples; the bar is the spread between the samples.
-->
<script lang="ts">
	import { T11, isaTemperature } from '#lib/modes/air-data.ts';
	import { MIN_SAMPLES, type Layer, type Tropopause } from '#lib/weather/profile.ts';
	import { BOTTOM, H, H_MAX, LEFT, LEVELS, RIGHT, TOP, W, xAxis, y } from './profile-chart';

	let { layers, tropopause }: { layers: Layer[]; tropopause: Tropopause } = $props();

	/** °C */
	const T_MIN = -70;
	const T_MAX = 30;
	const xc = xAxis(T_MIN, T_MAX);
	const x = (kelvin: number) => xc(kelvin - 273.15);

	/** The standard atmosphere: 15 °C at sea level, −6.5 K/km, −56.5 °C from 36,089 ft. */
	const isa = [
		[isaTemperature(0), 0],
		[T11, 36_089],
		[T11, H_MAX]
	]
		.map(([t, h]) => `${x(t)},${y(h)}`)
		.join(' ');

	const temperatures = [-60, -40, -20, 0, 20];

	let measured = $derived(layers.filter((l) => l.temperature));
</script>

<svg
	viewBox="0 0 {W} {H}"
	class="h-auto w-full rounded bg-zinc-950"
	role="img"
	aria-label="Temperature against altitude, per 1,000 ft layer, with the standard atmosphere"
>
	<g class="fill-zinc-500 text-[10px]">
		{#each temperatures as c (c)}
			<line x1={xc(c)} y1={TOP} x2={xc(c)} y2={H - BOTTOM} class="stroke-zinc-800" />
			<text x={xc(c)} y={H - BOTTOM + 12} text-anchor="middle">{c < 0 ? `−${-c}` : c}°</text>
		{/each}
		{#each LEVELS as h (h)}
			<line x1={LEFT} y1={y(h)} x2={W - RIGHT} y2={y(h)} class="stroke-zinc-800" />
			<text x={LEFT - 4} y={y(h) + 3} text-anchor="end">FL{h / 100}</text>
		{/each}
		<text x={(LEFT + W - RIGHT) / 2} y={H - 4} text-anchor="middle">temperature, °C</text>
	</g>

	<polyline
		points={isa}
		class="fill-none stroke-zinc-400"
		stroke-width="1.5"
		stroke-dasharray="4 3"
	/>
	<text x={x(isaTemperature(15_000)) + 6} y={y(15_000)} class="fill-zinc-400 text-[10px]">ISA</text>

	{#if tropopause.found}
		<line
			x1={LEFT}
			y1={y(tropopause.level)}
			x2={W - RIGHT}
			y2={y(tropopause.level)}
			class="stroke-amber-400"
			stroke-dasharray="6 3"
		/>
		<text
			x={W - RIGHT - 2}
			y={y(tropopause.level) - 4}
			text-anchor="end"
			class="fill-amber-300 text-[10px]"
		>
			tropopause{tropopause.atOrBelow ? ' (or lower)' : ''}
		</text>
	{/if}

	{#each measured as l (l.level)}
		{@const t = l.temperature!}
		{@const yy = y(l.level)}
		<line
			x1={x(t.kelvin - t.spread)}
			y1={yy}
			x2={x(t.kelvin + t.spread)}
			y2={yy}
			class="stroke-zinc-500"
		/>
		<circle
			cx={x(t.kelvin)}
			cy={yy}
			r="3"
			class={t.n >= MIN_SAMPLES ? 'fill-rose-300' : 'fill-zinc-950 stroke-rose-300'}
		>
			<title>{`FL${l.level / 100}: ${(t.kelvin - 273.15).toFixed(1)} °C, ${t.n} samples`}</title>
		</circle>
	{/each}

	{#if measured.length === 0}
		<text x={(LEFT + W) / 2} y={H / 2} text-anchor="middle" class="fill-zinc-500 text-[11px]">
			no temperatures yet
		</text>
	{/if}
</svg>
