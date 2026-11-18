<!--
	The geostrophic wind (lib/weather/geostrophic.ts): the wind the slope of the pressure
	surfaces calls for, from how GNSS − baro changes along each level flight. The map shows
	the flights around the receiver, each point coloured by how much higher or lower its
	pressure level was than the flight's average, with the fitted height contours and the
	wind along them.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { degrees, flightLevel, windText } from '#lib/describe/weather.ts';
	import {
		MIN_GEOSTROPHIC_AIRCRAFT,
		MIN_SEGMENT_KM,
		MIN_SPREAD_KM,
		type Geostrophic
	} from '#lib/weather/geostrophic.ts';
	import { directionOf, speedOf, type Wind } from '#lib/weather/wind.ts';

	interface Props {
		geo: Geostrophic;
		/** The aircraft's measured mean wind over the same levels, if any. */
		measured: Wind | null;
	}

	let { geo, measured }: Props = $props();

	const SIZE = 300;
	const C = SIZE / 2;

	/** Map radius, km: the farthest point, rounded up to 100 km. */
	let radius = $derived(
		Math.max(
			100,
			Math.ceil(
				Math.max(
					0,
					...geo.segments.flatMap((s) => s.points.map((p) => Math.hypot(p.north, p.east)))
				) / 100
			) * 100
		)
	);
	let scale = $derived((C - 10) / radius);
	const px = (p: { north: number; east: number }) => ({
		x: C + p.east * scale,
		y: C - p.north * scale
	});

	/** Each point against its own flight's mean, ft: only the change along a flight counts. */
	let points = $derived(
		geo.segments.flatMap((s) => {
			const mean = s.points.reduce((a, p) => a + p.offset, 0) / s.points.length;
			return s.points.map((p) => ({ ...px(p), d: p.offset - mean }));
		})
	);
	const tone = (d: number) =>
		d < -60
			? 'fill-sky-400'
			: d < -20
				? 'fill-sky-200'
				: d <= 20
					? 'fill-zinc-300'
					: d <= 60
						? 'fill-rose-200'
						: 'fill-rose-400';

	/** Height contours of the fitted plane, every `step` ft, as long lines across the map. */
	let contours = $derived.by(() => {
		if (!geo.found) return null;
		const s = geo.slope; // ft per 100 km
		const len = speedOf(s);
		if (len === 0) return null;
		const across = (len * 2 * radius) / 100; // ft from edge to edge
		const step = [10, 20, 25, 50, 100, 200].find((x) => across / x <= 8) ?? 500;
		const unit = { north: s.north / len, east: s.east / len };
		const lines = [];
		for (let k = -8; k <= 8; k++) {
			const at = ((k * step) / len) * 100; // km along the slope
			const mid = { north: unit.north * at, east: unit.east * at };
			const a = px({
				north: mid.north - unit.east * 2 * radius,
				east: mid.east + unit.north * 2 * radius
			});
			const b = px({
				north: mid.north + unit.east * 2 * radius,
				east: mid.east - unit.north * 2 * radius
			});
			lines.push({ k, a, b });
		}
		return { step, lines, uphill: directionOf(s) };
	});

	/** The wind arrow: 50 px per 100 kt, through the receiver. */
	let arrow = $derived.by(() => {
		if (!geo.found) return null;
		const v = geo.wind.vector;
		const k = 0.5;
		return { x1: C - v.east * k, y1: C + v.north * k, x2: C + v.east * k, y2: C - v.north * k };
	});
</script>

<!-- Without a level flight there's nothing to plot: the card is its title and what it needs. -->
<div class="rounded-lg bg-zinc-900 p-4">
	<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<InfoTip
			heading="h3"
			class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
			label="Geostrophic wind"
			wide
		>
			<p>
				The wind that the <strong>slope of the pressure surfaces</strong> calls for, measured with GNSS
				− baro alone: no heading, no airspeed, no radar questions.
			</p>
			<p>
				An aircraft in level flight holds its pressure altitude, so it follows a surface of constant
				pressure. Those surfaces aren't flat: they sag over cold air and low pressure. So along the
				way its GNSS height rises and falls while its pressure altitude stays put.
			</p>
			<p>
				On the rotating Earth, air doesn't flow down such a slope. The pressure force pushes it
				downhill, the Coriolis force to the right of its motion, and they balance when it flows
				<strong>along the height contours</strong>, the low side on its left (in the northern
				hemisphere): wind = (g / f) × slope, with f = 2Ω · sin(latitude). That's why the wind
				follows the isobars on a weather map.
			</p>
			<p class="text-zinc-400">
				Each aircraft at each level gets its own offset, so its altimeter's own error drops out.
				Needs
				{MIN_GEOSTROPHIC_AIRCRAFT} aircraft that each flew {MIN_SEGMENT_KM} km level, together spread
				at least {MIN_SPREAD_KM} km (rms) in every direction: along one airway alone, the slope across
				it is unknown. A balance, not a measurement: around a low the real wind is slower, around a high
				faster. Against weather balloons: within 2° of their direction, 30 % faster.
			</p>
		</InfoTip>
		{#if geo.found}
			<span class="font-mono text-lg text-emerald-300">{windText(geo.wind)}</span>
			{#if geo.uncertainty !== null}
				<span class="text-sm text-zinc-500">± {Math.round(geo.uncertainty)} kt</span>
			{/if}
		{/if}
	</div>

	{#if points.length === 0 && !geo.found}
		<p class="text-sm text-zinc-400">{geo.reason}</p>
	{:else}
		<div class="grid gap-4 sm:grid-cols-[minmax(0,300px)_1fr]">
			<svg
				viewBox="0 0 {SIZE} {SIZE}"
				class="h-auto w-full rounded bg-zinc-950"
				role="img"
				aria-label="Level flights around the receiver, coloured by the height of their pressure level, with the fitted height contours"
			>
				<defs>
					<clipPath id="geo-clip"><rect width={SIZE} height={SIZE} /></clipPath>
					<marker
						id="geo-arrow"
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
				{#each [radius / 2, radius] as r (r)}
					<circle cx={C} cy={C} r={r * scale} class="fill-none stroke-zinc-800" />
					<text x={C + 3} y={C - r * scale + 11} class="fill-zinc-600 text-[9px]">{r} km</text>
				{/each}
				<text x={C} y="10" text-anchor="middle" class="fill-zinc-500 text-[9px]">N</text>

				{#if contours}
					<g clip-path="url(#geo-clip)">
						{#each contours.lines as l (l.k)}
							<line
								x1={l.a.x}
								y1={l.a.y}
								x2={l.b.x}
								y2={l.b.y}
								class={l.k === 0 ? 'stroke-zinc-500' : 'stroke-zinc-700'}
								stroke-dasharray="3 3"
							/>
						{/each}
					</g>
				{/if}

				{#each points as p, i (i)}
					<circle cx={p.x} cy={p.y} r="2.2" class={tone(p.d)} />
				{/each}
				<circle cx={C} cy={C} r="3" class="fill-amber-300" />

				{#if arrow}
					<line
						{...arrow}
						class="stroke-emerald-300"
						stroke-width="2"
						marker-end="url(#geo-arrow)"
					/>
				{/if}
			</svg>

			<div class="space-y-2 text-sm">
				{#if geo.found}
					<p>
						The pressure surfaces rise towards {degrees(contours?.uphill ?? 0)}, by
						{speedOf(geo.slope).toFixed(0)} ft per 100 km
						{#if contours}(contours every {contours.step} ft){/if}.
					</p>
					<p class="text-zinc-400">
						At {geo.latitude.toFixed(1)}° f = {(geo.coriolis * 1e4).toFixed(3)} × 10⁻⁴ /s, so the wind
						along the contours is {Math.round(geo.wind.speed)} kt.
					</p>
					<p class="text-zinc-400">
						{geo.aircraft} aircraft, {geo.segments.length} level flights, {geo.samples} samples, {flightLevel(
							geo.levels[0]
						)}–{flightLevel(geo.levels[1])}. The plane leaves {geo.residual.toFixed(0)} ft rms (GNSS −
						baro comes in 25 ft steps){geo.uncertainty === null
							? '; too few aircraft keep the spread when one is left out to tell how much the wind depends on any one of them.'
							: `; leaving out any one aircraft moves the wind by up to ${Math.round(geo.uncertainty)} kt.`}
					</p>
					{#if measured}
						<p>
							Measured by the aircraft (5,0/6,0) over the same levels:
							<span class="font-mono text-emerald-300">{windText(measured)}</span>.
						</p>
					{/if}
				{:else}
					<p class="text-zinc-500">{geo.reason}</p>
				{/if}
				<p class="text-xs text-zinc-500">
					Dots: each flight's pressure level against its own average,
					<span class="text-sky-300">lower</span> to <span class="text-rose-300">higher</span>
					(±20 and ±60 ft). Amber: the receiver.
				</p>
			</div>
		</div>
	{/if}
</div>
