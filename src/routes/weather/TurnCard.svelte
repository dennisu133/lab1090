<!--
	Winds from turns (lib/weather/circle.ts): the latest turn's ground vectors drawn from
	one point (a hodograph), the circle fitted through them, and its centre, the wind. Below,
	the turns of the last half hour.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { flightLevel, signed, windText } from '#lib/describe/weather.ts';
	import {
		MAX_CLIMB_FT,
		MAX_RESIDUAL_KT,
		MAX_TURN_MS,
		MIN_ARC,
		TURN_RATE,
		type TurnWind
	} from '#lib/weather/circle.ts';

	interface Props {
		turns: TurnWind[];
		callsigns: Map<string, string>;
	}

	let { turns, callsigns }: Props = $props();

	const SIZE = 240;
	const C = SIZE / 2;

	let latest = $derived(turns.at(-1) ?? null);
	/** Scale so the circle and the origin fit: the farthest point, plus a margin. */
	let scale = $derived.by(() => {
		if (!latest) return 1;
		const far = Math.max(...latest.points.map((p) => Math.hypot(p.north, p.east)));
		return (C - 12) / Math.max(far, 1);
	});
	const x = (east: number) => C + east * scale;
	const y = (north: number) => C - north * scale;
</script>

<div class="rounded-lg bg-zinc-900 p-4">
	<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<InfoTip heading="h3" class="font-semibold" label="Winds from turns" wide>
			<p>
				An aircraft turning at a steady airspeed sweeps its air vector (TAS along the heading)
				around a circle. Its ground vector, which ADS-B broadcasts twice a second, is that plus the
				wind: so the ground vectors lie on the same circle, <strong>shifted by the wind</strong>.
				Fit a circle through them: the centre is the wind, the radius the true airspeed.
			</p>
			<p>
				No heading, no airspeed, no radar questions: ADS-B alone, so a compass that's off doesn't
				matter. Gliders and drones find the wind the same way.
			</p>
			<p class="text-zinc-400">
				A turn is a track changing by {TURN_RATE}°/s or more; it needs {MIN_ARC}° of heading, within {MAX_TURN_MS /
					60_000} minutes and {MAX_CLIMB_FT.toLocaleString()} ft. An aircraft slowing down steadily spirals
				inwards, which the fit allows for; anything else that leaves the points more than {MAX_RESIDUAL_KT}
				kt off the curve doesn't count. Most turns happen near airports: holding patterns, approaches.
				Cruise traffic on airways rarely turns that far.
			</p>
		</InfoTip>
		<span class="text-sm text-zinc-500">
			{turns.length ? `${turns.length} in the last 30 min` : 'no turn of 90° or more yet'}
		</span>
	</div>

	<div class="grid gap-4 sm:grid-cols-[minmax(0,240px)_1fr]">
		<svg
			viewBox="0 0 {SIZE} {SIZE}"
			class="h-auto w-full rounded bg-zinc-950"
			role="img"
			aria-label="The latest turn's ground vectors from one point, with the fitted circle and the wind at its centre"
		>
			<defs>
				<marker
					id="turn-arrow"
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
			<line x1={C} y1="0" x2={C} y2={SIZE} class="stroke-zinc-800" />
			<line x1="0" y1={C} x2={SIZE} y2={C} class="stroke-zinc-800" />
			<text x={C + 3} y="10" class="fill-zinc-600 text-[9px]">north, kt</text>
			{#if latest}
				{@const w = latest.wind.vector}
				<circle
					cx={x(w.east)}
					cy={y(w.north)}
					r={latest.tas * scale}
					class="fill-none stroke-zinc-600"
					stroke-dasharray="3 3"
				/>
				{#each latest.points as p, i (i)}
					<circle cx={x(p.east)} cy={y(p.north)} r="1.6" class="fill-sky-300" />
				{/each}
				<line
					x1={C}
					y1={C}
					x2={x(w.east)}
					y2={y(w.north)}
					class="stroke-emerald-300"
					stroke-width="2"
					marker-end="url(#turn-arrow)"
				/>
				<circle cx={C} cy={C} r="2.5" class="fill-zinc-300" />
			{:else}
				<text x={C} y={C + 24} text-anchor="middle" class="fill-zinc-500 text-[11px]">
					waiting for a turn
				</text>
			{/if}
		</svg>

		<div class="space-y-2 text-sm">
			{#if latest}
				<p>
					<span class="font-mono text-amber-300">{latest.icao}</span>
					<span class="text-zinc-500">{callsigns.get(latest.icao) ?? ''}</span>
					turned {Math.abs(latest.arc).toFixed(0)}° {latest.arc > 0 ? 'right' : 'left'} at {flightLevel(
						Math.round(latest.altitude / 100) * 100
					)}, in {Math.round((latest.end - latest.start) / 1000)} s.
				</p>
				<p>
					Wind <span class="font-mono text-emerald-300">{windText(latest.wind)}</span> (the arrow to
					the centre), TAS {Math.round(latest.tas)} kt (the radius){Math.abs(latest.tasChange) >= 3
						? `, ${signed(latest.tasChange, 0)} kt over the turn`
						: ''}.
				</p>
				<p class="text-zinc-400">
					{latest.points.length} ground vectors, {latest.residual.toFixed(1)} kt rms off the fitted curve
					(ADS-B sends whole knots).
				</p>
			{/if}
			{#if turns.length > 1}
				<table class="w-full table-fixed text-xs tabular-nums">
					<tbody>
						{#each turns.slice(-6, -1).reverse() as t (t.end + t.icao)}
							<tr class="h-6 border-t border-zinc-800">
								<td class="w-16 font-mono text-amber-300">{t.icao}</td>
								<td class="w-16 text-zinc-400">{flightLevel(Math.round(t.altitude / 100) * 100)}</td
								>
								<td class="font-mono text-emerald-300">{windText(t.wind)}</td>
								<td class="w-12 text-zinc-500">{Math.abs(t.arc).toFixed(0)}°</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<p class="text-xs text-zinc-500">
				Winds from turns join the layers like any other, and the heading checks use them as a
				reference: they can't share a compass error.
			</p>
		</div>
	</div>
</div>
