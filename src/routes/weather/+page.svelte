<!--
	/weather, "Now": the air above the receiver, from every aircraft together. Temperature and
	wind by altitude (from 5,0/6,0), the tropopause and the strongest wind, and the temperature
	of the air column below each level (from ADS-B's GNSS − baro and the pilots' QNH). Then
	three more ways to the wind: the geostrophic wind from the slope of the pressure
	surfaces, heading checks against the other aircraft, and winds from turns.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { flightLevel, hpa, isaText, signed, windText } from '#lib/describe/weather.ts';
	import { column, type HeightReference } from '#lib/weather/column.ts';
	import {
		JET_KT,
		MIN_AIRCRAFT,
		MIN_SAMPLES,
		TROPOPAUSE_LAPSE,
		layers,
		strongestWind,
		tropopause
	} from '#lib/weather/profile.ts';
	import { WINDOW_MS, qnh } from '#lib/weather/sky.ts';
	import { geostrophicWind } from '#lib/weather/geostrophic.ts';
	import { meanWind } from '#lib/weather/wind.ts';
	import ColumnCalculation from './ColumnCalculation.svelte';
	import ColumnChart from './ColumnChart.svelte';
	import GeostrophicCard from './GeostrophicCard.svelte';
	import HeadingCard from './HeadingCard.svelte';
	import TurnCard from './TurnCard.svelte';
	import LayerTable from './LayerTable.svelte';
	import QnhCard from './QnhCard.svelte';
	import TemperatureProfile from './TemperatureProfile.svelte';
	import WindProfile from './WindProfile.svelte';
	import PageTitle from '../PageTitle.svelte';
	import { getStreams } from '../streams';

	const stream = getStreams().weather;

	let heights = $state<HeightReference>('ellipsoid');
	/** The layer picked in the table for the worked example. */
	let picked = $state<number | null>(null);

	/** Whether the profile uses the heading-corrected winds (HeadingCard). */
	let correctHeadings = $state(true);

	let sky = $derived(stream.sky);
	let checks = $derived(stream.checks);
	let winds = $derived(correctHeadings ? stream.correctedWinds : sky.winds);
	let all = $derived(layers(sky.temperatures, winds, sky.columns));
	let callsigns = $derived(
		new Map(stream.aircraft.flatMap((a) => (a.callsign ? [[a.icao, a.callsign]] : [])))
	);
	let pressure = $derived(qnh(sky.settings));
	let columns = $derived(
		all.map((l) => (l.column ? column(l.column, { qnh: pressure.hPa, heights }) : null))
	);
	let top = $derived(tropopause(all));
	let strongest = $derived(strongestWind(all));
	let geo = $derived(geostrophicWind(sky.columns, stream.reference, heights));
	/** The aircraft's own mean wind over the levels the geostrophic fit covers. */
	let measuredThere = $derived(
		geo.found
			? meanWind(
					all.flatMap((l) =>
						l.wind && l.level >= geo.levels[0] - 500 && l.level <= geo.levels[1] + 500
							? [l.wind.wind]
							: []
					)
				)
			: null
	);

	/** The worked example: the picked layer, else the one with the most GNSS − baro samples. */
	let example = $derived.by(() => {
		let i = all.findIndex((l) => l.level === picked && l.column);
		if (i < 0)
			i = all.reduce(
				(best, l, j) => (l.column && (best < 0 || l.column.n > all[best].column!.n) ? j : best),
				-1
			);
		return i < 0 ? null : { layer: all[i], column: columns[i]! };
	});

	let minutes = $derived(
		stream.since === null ? 0 : Math.min(WINDOW_MS, stream.now - stream.since) / 60_000
	);
	let aircraft = $derived(
		new Set([...sky.temperatures, ...sky.winds, ...sky.columns].map((s) => s.icao)).size
	);
</script>

<PageTitle page="Weather now" />

<div class="space-y-6">
	<div class="flex flex-wrap items-baseline gap-x-1 text-sm text-zinc-400">
		<InfoTip label="Collected" wide>
			<p>
				All decoding happens here in the browser, so collecting starts when you open the app (on any
				page) and keeps going while you switch pages; reloading starts over. Samples older than {WINDOW_MS /
					60_000} minutes are dropped: the weather changes, and aircraft move on.
			</p>
			<p>
				A profile needs aircraft at many levels. Cruising aircraft fill FL300–FL410 within minutes;
				the levels below fill as aircraft climb out and descend into the airports in range, like a
				weather balloon on its way up.
			</p>
		</InfoTip>
		<span>
			over the last {minutes < 1 ? 'minute' : `${Math.floor(minutes)} min`}: {aircraft} aircraft,
			{sky.temperatures.length} temperatures, {sky.winds.length} winds, {sky.columns.length} GNSS heights,
			{sky.settings.length} pressure settings.
		</span>
	</div>

	<!-- Summary. Fixed heights: nothing below jumps as the values change. -->
	<section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<div class="h-36 rounded-lg bg-zinc-900 p-4">
			<InfoTip heading="h2" class="text-sm font-semibold text-zinc-400" label="Tropopause" wide>
				<p>
					The top of the weather. Below it (the troposphere) the air is warmed from the ground and
					cools with height, about 6.5 K per km; above it (the stratosphere) the temperature stops
					falling, because ozone absorbs sunlight there. Clouds and storms mostly stay below it;
					airliners cruise just below or just above it.
				</p>
				<p>
					By the WMO's definition (the one weather balloons use): the lowest level where the
					temperature falls by {TROPOPAUSE_LAPSE} K per km or less, and keeps doing so on average for
					the next 2 km. Only layers with at least {MIN_SAMPLES} temperatures from {MIN_AIRCRAFT} or more
					aircraft count: each aircraft has its own sensor errors.
				</p>
				<p class="text-zinc-400">
					Over Europe usually FL300–FL390: lower in cold polar air, higher in warm air. The standard
					atmosphere puts it at 36,089 ft.
				</p>
			</InfoTip>
			{#if top.found}
				<p class="mt-2 text-2xl text-amber-300">
					{top.atOrBelow ? '≤ ' : ''}{flightLevel(top.level)}
				</p>
				<p class="mt-1 text-xs text-zinc-500">
					{signed(top.lapse)} K/km to the next layer, checked up to {flightLevel(top.checkedTo)}.
					{top.atOrBelow ? 'Already the lowest layer with enough data: may be lower.' : ''}
				</p>
			{:else}
				<p class="mt-2 text-2xl text-zinc-500">not found</p>
				<p class="mt-1 text-xs text-zinc-500">{top.reason}</p>
			{/if}
		</div>

		<div class="h-36 rounded-lg bg-zinc-900 p-4">
			<InfoTip heading="h2" class="text-sm font-semibold text-zinc-400" label="Strongest wind" wide>
				<p>
					The layer with the fastest mean wind. A <strong>jet stream</strong> is a narrow band of
					fast wind, at least 30 m/s ({Math.round(JET_KT)} kt) by the WMO's definition, usually just below
					the tropopause, where cold polar air meets warmer air. Over Europe it often reaches 100–200
					kt in winter.
				</p>
				<p class="text-zinc-400">
					It's why flights from America to Europe are an hour shorter than the other way. If the
					strongest layer is the highest or lowest one with data, the core may be beyond it.
				</p>
			</InfoTip>
			{#if strongest}
				<p class="mt-2 font-mono text-2xl text-emerald-300">{windText(strongest.wind)}</p>
				<p class="mt-1 text-xs text-zinc-500">
					at {flightLevel(strongest.level)}{strongest.jet ? ': jet stream strength' : ''}.
					{strongest.atTop
						? 'The highest layer with data: it may be stronger above.'
						: strongest.atBottom
							? 'The lowest layer with data: it may be stronger below.'
							: ''}
				</p>
			{:else}
				<p class="mt-2 text-2xl text-zinc-500">—</p>
				<p class="mt-1 text-xs text-zinc-500">
					No layer with {MIN_SAMPLES} winds from {MIN_AIRCRAFT} aircraft yet.
				</p>
			{/if}
		</div>

		<div class="h-36 rounded-lg bg-zinc-900 p-4">
			<InfoTip heading="h2" class="text-sm font-semibold text-zinc-400" label="Sea-level pressure">
				<p>
					QNH: the pressure the pilots near the ground set on their altimeters. More on it below,
					next to the column calculation.
				</p>
			</InfoTip>
			<p class="mt-2 text-2xl">{hpa(pressure.hPa)}</p>
			<p class="mt-1 text-xs text-zinc-500">
				{pressure.local.length
					? `Median of ${pressure.local.length} aircraft's local settings.`
					: `Assumed standard: ${pressure.standard} aircraft reported a setting, all on 1013.`}
			</p>
		</div>

		<div class="h-36 rounded-lg bg-zinc-900 p-4">
			<InfoTip
				heading="h2"
				class="text-sm font-semibold text-zinc-400"
				label="Air column"
				align="right"
			>
				<p>
					How much warmer or colder than standard the air is on average from the ground up to the
					layer with the most GNSS heights (or the one you picked in the table), from how far the
					aircraft's GNSS height is from its pressure altitude. The calculation is below.
				</p>
			</InfoTip>
			{#if example}
				<p class="mt-2 text-2xl text-amber-300">{isaText(example.column.isaDeviation)}</p>
				<p class="mt-1 text-xs text-zinc-500">
					Mean of the air below {flightLevel(example.layer.level)}, from {example.layer.column!.n}
					samples.
				</p>
			{:else}
				<p class="mt-2 text-2xl text-zinc-500">—</p>
				<p class="mt-1 text-xs text-zinc-500">No GNSS − baro heard yet.</p>
			{/if}
		</div>
	</section>

	<!-- The three profiles share the altitude axis. -->
	<section class="grid gap-4 lg:grid-cols-3">
		<div class="rounded-lg bg-zinc-900 p-4">
			<InfoTip heading="h2" class="mb-2 text-sm font-semibold text-zinc-400" label="Temperature">
				<p>
					Each layer's mean temperature (dot) and how much the samples differ (bar), against the
					standard atmosphere (dashed). Hollow: fewer than {MIN_SAMPLES} samples, or all from one aircraft.
				</p>
			</InfoTip>
			<TemperatureProfile layers={all} tropopause={top} />
		</div>
		<div class="rounded-lg bg-zinc-900 p-4">
			<InfoTip heading="h2" class="mb-2 text-sm font-semibold text-zinc-400" label="Wind">
				<p>
					Each layer's mean wind speed, with an arrow pointing where the air goes (up is north: an
					arrow to the right is a westerly). The dashed line is jet stream strength. Hollow: fewer
					than {MIN_SAMPLES} samples, or all from one aircraft.
				</p>
			</InfoTip>
			<WindProfile layers={all} {strongest} />
		</div>
		<div class="rounded-lg bg-zinc-900 p-4">
			<InfoTip
				heading="h2"
				class="mb-2 text-sm font-semibold text-zinc-400"
				label="Height − pressure altitude"
				align="right"
			>
				<p>
					How far each layer's pressure level really is from where the standard atmosphere puts it
					(after the geoid and geopotential corrections). The guides show what a column with that
					mean deviation from standard would give, at today's QNH: they fan out because each kelvin
					counts for more the more air is below.
				</p>
				<p class="text-zinc-400">
					A dot left of the dashed ISA line: the level is lower than standard, the air below colder
					(or the pressure lower). Hollow: fewer than {MIN_SAMPLES} samples, or all from one aircraft.
				</p>
			</InfoTip>
			<ColumnChart
				layers={all}
				{columns}
				qnh={pressure.hPa}
				selected={example?.layer.level ?? null}
			/>
		</div>
	</section>

	<section>
		<h2 class="mb-2 text-sm font-semibold tracking-wide text-zinc-400 uppercase">Layers</h2>
		<LayerTable
			layers={all}
			{columns}
			tropopause={top}
			{strongest}
			selected={example?.layer.level ?? null}
			onselect={(level) => (picked = level)}
		/>
	</section>

	<section class="grid gap-4 xl:grid-cols-2">
		{#if example}
			<ColumnCalculation
				layer={example.layer}
				column={example.column}
				qnh={pressure}
				bind:heights
			/>
		{:else}
			<p class="rounded-lg bg-zinc-900 p-4 text-sm text-zinc-500">
				Waiting for GNSS − baro (ADS-B velocity messages, TC 19)…
			</p>
		{/if}
		<QnhCard qnh={pressure} now={stream.now} />
	</section>

	<section class="grid gap-4 xl:grid-cols-2">
		<GeostrophicCard {geo} measured={measuredThere} />
		<HeadingCard {checks} {callsigns} bind:correct={correctHeadings} />
		<TurnCard turns={sky.turns} {callsigns} />
	</section>
</div>
