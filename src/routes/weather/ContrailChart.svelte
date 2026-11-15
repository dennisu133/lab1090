<!--
	The Schmidt–Appleman diagram (lib/weather/contrail.ts): water vapour pressure against
	temperature. The solid curve is saturation over liquid water, the dashed one over ice.
	The engine's exhaust, mixing into the air, moves along a straight line of slope G (amber);
	the one drawn just touches the water curve. Any air on or above it gives a contrail.

	This air is the vertical bar at its temperature: from no water vapour (0 %) at the
	bottom to saturated (100 %) where it meets the curve. Blue where a contrail forms, grey
	where not; the white tick is ice saturation (above it, a contrail lasts). The shaded
	stripe is the ±TEMPERATURE_MARGIN the answer allows.
-->
<script lang="ts">
	import {
		TEMPERATURE_MARGIN,
		saturationOverIce,
		saturationOverWater,
		type Contrail
	} from '#lib/weather/contrail.ts';

	let { kelvin, result }: { kelvin: number; result: Contrail } = $props();

	const SIZE = 240;
	const LEFT = 32;
	const BOTTOM = 20;
	const TOP = 10;
	const RIGHT = 8;
	/** At most this far beyond the thresholds, K: further out, the curve would flatten them. */
	const REACH = 12;

	let t = $derived(result.thresholds);
	/** °C, in 5° steps, from a little colder than the dry threshold to warmer than T_LM. */
	let lo = $derived(
		Math.floor(
			(Math.max(Math.min(t.dry, kelvin - TEMPERATURE_MARGIN), t.dry - REACH) - 3 - 273.15) / 5
		) * 5
	);
	let hi = $derived(
		Math.ceil(
			(Math.min(Math.max(t.saturated, kelvin + TEMPERATURE_MARGIN), t.saturated + REACH) +
				3 -
				273.15) /
				5
		) * 5
	);
	let eMax = $derived(saturationOverWater(hi + 273.15));
	/** Grid lines for the vapour pressure, Pa. */
	let eStep = $derived(eMax < 30 ? 5 : eMax < 60 ? 10 : eMax < 150 ? 25 : 50);

	/** Kelvin and Pa to the drawing. They read the axes when called, so they stay reactive. */
	const x = (k: number) => LEFT + ((k - 273.15 - lo) / (hi - lo)) * (SIZE - LEFT - RIGHT);
	const y = (pa: number) => SIZE - BOTTOM - (pa / eMax) * (SIZE - BOTTOM - TOP);

	/** A curve over the whole range, cut off at the top. */
	function curve(e: (k: number) => number): string {
		const points: string[] = [];
		for (let i = 0; i <= 60; i++) {
			const k = lo + 273.15 + ((hi - lo) * i) / 60;
			if (e(k) <= eMax) points.push(`${x(k)},${y(e(k))}`);
		}
		return points.join(' ');
	}

	let water = $derived(curve(saturationOverWater));
	let ice = $derived(curve(saturationOverIce));
	/** The tangent, from where it meets the axis (dry air) to the top or the right edge. */
	let tangent = $derived.by(() => {
		const top = Math.min(
			hi + 273.15,
			t.saturated + (eMax - saturationOverWater(t.saturated)) / t.slope
		);
		return {
			x1: x(t.dry),
			y1: y(0),
			x2: x(top),
			y2: y(saturationOverWater(t.saturated) + t.slope * (top - t.saturated))
		};
	});

	/**
	 * This air, clamped to the drawing (an arrow label at the bottom says how far off it is:
	 * the legend has the top left).
	 */
	let shown = $derived(Math.min(Math.max(kelvin, lo + 273.15), hi + 273.15));
	let outside = $derived(shown !== kelvin);
	let saturated = $derived(saturationOverWater(shown));
	/** Where the bar turns blue, Pa: the humidity needed. */
	let needed = $derived(
		result.humidityNeeded === null ? saturated : result.humidityNeeded * saturated
	);

	let temperatures = $derived(Array.from({ length: (hi - lo) / 5 + 1 }, (_, i) => lo + i * 5));
	let pressures = $derived(
		Array.from({ length: Math.floor(eMax / eStep) + 1 }, (_, i) => i * eStep)
	);
</script>

<svg
	viewBox="0 0 {SIZE} {SIZE}"
	class="h-auto w-full max-w-60 shrink-0 rounded bg-zinc-950"
	role="img"
	aria-label="Water vapour pressure against temperature: saturation over water and ice, the engine's mixing line, and this air's temperature"
>
	<g class="fill-zinc-500 text-[10px]">
		{#each temperatures as c (c)}
			<line
				x1={x(c + 273.15)}
				y1={TOP}
				x2={x(c + 273.15)}
				y2={SIZE - BOTTOM}
				class="stroke-zinc-800"
			/>
			<text x={x(c + 273.15)} y={SIZE - 6} text-anchor="middle">{c < 0 ? `−${-c}` : c}°</text>
		{/each}
		{#each pressures as p (p)}
			<line x1={LEFT} y1={y(p)} x2={SIZE - RIGHT} y2={y(p)} class="stroke-zinc-800" />
			<text x={LEFT - 4} y={y(p) + 3} text-anchor="end">{p}</text>
		{/each}
		<text x={LEFT - 4} y={TOP - 2} text-anchor="end">Pa</text>
	</g>

	<!-- The margin, then the curves and the line on top. -->
	<rect
		x={x(shown - TEMPERATURE_MARGIN)}
		y={TOP}
		width={x(shown + TEMPERATURE_MARGIN) - x(shown - TEMPERATURE_MARGIN)}
		height={SIZE - BOTTOM - TOP}
		class="fill-zinc-500/15"
	/>
	<polyline
		points={ice}
		class="fill-none stroke-sky-300/60"
		stroke-width="1"
		stroke-dasharray="3 3"
	/>
	<polyline points={water} class="fill-none stroke-sky-300" stroke-width="1.5" />
	<line {...tangent} class="stroke-amber-300" stroke-width="1.5" />

	<!-- The two thresholds. -->
	<circle
		cx={x(t.saturated)}
		cy={y(saturationOverWater(t.saturated))}
		r="3.5"
		class="fill-amber-300"
	/>
	<text
		x={x(t.saturated) - 6}
		y={y(saturationOverWater(t.saturated)) - 4}
		text-anchor="end"
		class="fill-amber-300 text-[10px]">100 %</text
	>
	<circle cx={x(t.dry)} cy={y(0)} r="3.5" class="fill-amber-300" />
	<!-- Low and to the right: the steep line leaves room there. -->
	<text x={x(t.dry) + 7} y={y(0) - 2} class="fill-amber-300 text-[10px]">0 %</text>

	<!-- This air: no contrail below the line (grey), a contrail above it (blue). -->
	<line
		x1={x(shown)}
		y1={y(0)}
		x2={x(shown)}
		y2={y(needed)}
		class="stroke-zinc-500"
		stroke-width="3"
	/>
	<line
		x1={x(shown)}
		y1={y(needed)}
		x2={x(shown)}
		y2={y(saturated)}
		class="stroke-sky-400"
		stroke-width="3"
	/>
	<line
		x1={x(shown) - 5}
		y1={y(saturationOverIce(shown))}
		x2={x(shown) + 5}
		y2={y(saturationOverIce(shown))}
		class="stroke-zinc-100"
		stroke-width="1.5"
	/>
	{#if outside}
		<text
			x={x(shown) + (kelvin > shown ? -4 : 4)}
			y={SIZE - BOTTOM - 8}
			text-anchor={kelvin > shown ? 'end' : 'start'}
			class="fill-zinc-300 text-[10px]"
			>{kelvin > shown ? '→' : '←'} {(kelvin - 273.15).toFixed(0)} °C</text
		>
	{/if}

	<!-- The legend, top left: the curves rise to the right, so that corner stays empty. -->
	<text x={LEFT + 4} y={TOP + 10} class="fill-sky-300 text-[10px]">water</text>
	<text x={LEFT + 4} y={TOP + 22} class="fill-sky-300/70 text-[10px]">ice (dashed)</text>
	<text x={LEFT + 4} y={TOP + 34} class="fill-amber-300 text-[10px]">engine</text>
</svg>
