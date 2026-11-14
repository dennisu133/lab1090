<!--
	How far each pressure level really is from where the standard atmosphere puts it
	(height − pressure altitude, after the geoid and geopotential corrections), against
	altitude. The guides are what a column of air with that mean deviation from ISA would
	give at today's QNH: the further up, the more each kelvin counts, so they fan out. A dot
	between the −5 and −10 guides means the air below is 5–10 K colder than standard.
-->
<script lang="ts">
	import { expectedOffset, type Column } from '#lib/weather/column.ts';
	import { MIN_SAMPLES, type Layer } from '#lib/weather/profile.ts';
	import { BOTTOM, H, H_MAX, LEFT, LEVELS, RIGHT, TOP, W, xAxis, y } from './profile-chart';

	interface Props {
		layers: Layer[];
		/** column() of each layer, same order; null where it has no GNSS − baro. */
		columns: (Column | null)[];
		qnh: number;
		/** The layer the worked example shows. */
		selected: number | null;
	}

	let { layers, columns, qnh, selected }: Props = $props();

	const MIN_FT = -2000;
	const MAX_FT = 2000;
	const x = xAxis(MIN_FT, MAX_FT);
	const clampX = (ft: number) => x(Math.min(Math.max(ft, MIN_FT), MAX_FT));
	/** Grid lines; only those within the axis get a label (±2000 would stick out). */
	const ticks = [-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000];
	const LABELLED = new Set([-1500, 0, 1500]);
	const GUIDES = [-10, -5, 0, 5, 10];

	let guides = $derived(
		GUIDES.map((dT) => ({
			dT,
			points: Array.from({ length: H_MAX / 1000 + 1 }, (_, i) => i * 1000)
				.map((h) => `${clampX(expectedOffset(h, dT, qnh))},${y(h)}`)
				.join(' ')
		}))
	);

	let points = $derived(
		layers.flatMap((l, i) => (l.column && columns[i] ? [{ l, c: columns[i]! }] : []))
	);
</script>

<svg
	viewBox="0 0 {W} {H}"
	class="h-auto w-full rounded bg-zinc-950"
	role="img"
	aria-label="Height minus pressure altitude against altitude, with guides for columns colder or warmer than standard"
>
	<g class="fill-zinc-500 text-[10px]">
		{#each ticks as ft (ft)}
			<line x1={x(ft)} y1={TOP} x2={x(ft)} y2={H - BOTTOM} class="stroke-zinc-800" />
			{#if LABELLED.has(ft)}
				<text x={x(ft)} y={H - BOTTOM + 12} text-anchor="middle">
					{ft < 0 ? `−${-ft}` : ft > 0 ? `+${ft}` : '0'}
				</text>
			{/if}
		{/each}
		{#each LEVELS as h (h)}
			<line x1={LEFT} y1={y(h)} x2={W - RIGHT} y2={y(h)} class="stroke-zinc-800" />
			<text x={LEFT - 4} y={y(h) + 3} text-anchor="end">FL{h / 100}</text>
		{/each}
		<text x={(LEFT + W - RIGHT) / 2} y={H - 4} text-anchor="middle">
			height − pressure altitude, ft
		</text>
	</g>

	{#each guides as g (g.dT)}
		<polyline
			points={g.points}
			class={[
				'fill-none',
				g.dT === 0 ? 'stroke-zinc-400' : g.dT < 0 ? 'stroke-sky-700' : 'stroke-rose-800'
			]}
			stroke-dasharray={g.dT === 0 ? '4 3' : '2 3'}
		/>
		<text
			x={clampX(expectedOffset(H_MAX, g.dT, qnh))}
			y={TOP - 3}
			text-anchor="middle"
			class={[
				'text-[9px]',
				g.dT === 0 ? 'fill-zinc-400' : g.dT < 0 ? 'fill-sky-400' : 'fill-rose-400'
			]}
		>
			{g.dT === 0 ? 'ISA' : g.dT > 0 ? `+${g.dT}` : `−${-g.dT}`}
		</text>
	{/each}

	{#each points as { l, c } (l.level)}
		{@const enough = l.column!.n >= MIN_SAMPLES}
		<circle
			cx={clampX(c.offset)}
			cy={y(l.level)}
			r={selected === l.level ? 4.5 : 3}
			class={[
				enough ? 'fill-amber-300' : 'fill-zinc-950 stroke-amber-300',
				selected === l.level && 'stroke-white'
			]}
		>
			<title>
				{`FL${l.level / 100}: ${Math.round(c.offset)} ft, column ${c.isaDeviation >= 0 ? '+' : '−'}${Math.abs(c.isaDeviation).toFixed(1)} K, ${l.column!.n} samples`}
			</title>
		</circle>
	{/each}

	{#if points.length === 0}
		<text x={(LEFT + W) / 2} y={H / 2} text-anchor="middle" class="fill-zinc-500 text-[11px]">
			no GNSS heights yet
		</text>
	{/if}
</svg>
