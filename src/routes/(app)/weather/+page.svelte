<!--
	/weather, "Profile": the air above the receiver, layer by layer, from every aircraft
	together over the last half hour. First the answer: the tropopause, the strongest wind,
	the pressure and the air column, then temperature and wind by altitude (from 5,0/6,0 and
	turns) and the temperature of the air column below each level (from ADS-B's GNSS − baro
	and the pilots' QNH), then the layers' numbers. Then how the column and the pressure are
	worked out, and three checks on the winds: the geostrophic wind from the slope of the
	pressure surfaces, each aircraft's heading against the others', and winds from turns,
	which need no heading at all.
	What one aircraft gives on its own is on the Aircraft tab.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { contrailRuns, runText } from '#lib/describe/contrail.ts';
	import { hpa, levelOrFeet, signed } from '#lib/describe/format.ts';
	import { isaText, windText } from '#lib/describe/weather.ts';
	import { column, type HeightReference } from '#lib/weather/column.ts';
	import { ETA, ETA_MODERN, TEMPERATURE_MARGIN } from '#lib/weather/contrail.ts';
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
	import LayerTable from './LayerTable.svelte';
	import QnhCard from './QnhCard.svelte';
	import TemperatureProfile from './TemperatureProfile.svelte';
	import TurnCard from './TurnCard.svelte';
	import WindProfile from './WindProfile.svelte';
	import Segmented from '#lib/components/Segmented.svelte';
	import PageTitle from '../PageTitle.svelte';
	import { getStreams } from '../streams';
	import Card from './Card.svelte';
	import Tabs from './Tabs.svelte';

	const stream = getStreams().weather;

	let heights = $state<HeightReference>('ellipsoid');
	/** The layer picked in the table for the worked example. */
	let picked = $state<number | null>(null);
	let columnCard = $state<HTMLElement>();

	/** Pick a layer in the table (at the bottom) and bring its worked example into view. */
	function pick(level: number) {
		picked = level;
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		columnCard?.scrollIntoView({ behavior: still ? 'instant' : 'smooth', block: 'start' });
	}

	/** Whether the profile uses the heading-corrected winds (HeadingCard). */
	let correctHeadings = $state(true);
	const HEADINGS = [
		{ value: false, label: 'as sent' },
		{ value: true, label: 'corrected' }
	];

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
	let contrails = $derived(contrailRuns(all));
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

<PageTitle page="Weather profile" />

<div class="space-y-6">
	<Tabs>
		<div class="flex flex-wrap items-baseline justify-end gap-x-1 text-zinc-400">
			<InfoTip label="Collected" wide>
				<p>
					Nobody sends us the weather, but radars read every aircraft's speeds and heading for air
					traffic control, in registers <strong>5,0</strong> and <strong>6,0</strong>: enough to
					work out the wind and the temperature where it flies. ADS-B adds the gap between GNSS
					height and pressure altitude (how warm the air column below is) and the pilots' altimeter
					settings. The Dutch weather service (KNMI) feeds such observations into its forecasts.
				</p>
				<p>
					Collected here in the browser from the moment the app opened, on any page; reloading
					starts over. Samples older than {WINDOW_MS / 60_000} minutes are dropped. Cruising aircraft
					fill FL300–FL410 within minutes; the levels below fill as aircraft climb out and descend, like
					a weather balloon on its way up.
				</p>
				<p class="text-zinc-400">
					Sources: S. de Haan, "High-resolution wind and temperature observations from aircraft
					tracked by Mode-S air traffic control radar", J. Geophys. Res. (2011). J. Sun et al.,
					"Weather field reconstruction using aircraft surveillance data and a novel meteo-particle
					model", PLOS ONE (2018).
				</p>
			</InfoTip>
			<span>
				over the last {minutes < 1 ? 'minute' : `${Math.floor(minutes)} min`}: {aircraft} aircraft,
				{sky.temperatures.length} temperatures, {sky.winds.length} winds, {sky.columns.length} GNSS heights,
				{sky.settings.length} pressure settings.
			</span>
		</div>
	</Tabs>

	<!-- Summary. Fixed heights: nothing below jumps as the values change. -->
	<section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<Card heading="h2" title="Tropopause" class="h-36" wide>
			{#snippet info()}
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
			{/snippet}
			{#if top.found}
				<p class="mt-2 text-2xl font-semibold tracking-tight text-amber-300">
					{top.atOrBelow ? '≤ ' : ''}{levelOrFeet(top.level)}
				</p>
				<p class="mt-1 text-xs text-zinc-500">
					{signed(top.lapse)} K/km to the next layer, checked up to {levelOrFeet(top.checkedTo)}.
					{top.atOrBelow ? 'Already the lowest layer with enough data: may be lower.' : ''}
				</p>
			{:else}
				<p class="mt-2 text-2xl font-semibold tracking-tight text-zinc-500">not found</p>
				<p class="mt-1 text-xs text-zinc-500">{top.reason}</p>
			{/if}
		</Card>

		<Card heading="h2" title="Strongest wind" class="h-36" wide>
			{#snippet info()}
				<p>
					The layer with the fastest mean wind. A <strong>jet stream</strong> is a narrow band of
					fast wind, at least 30 m/s ({Math.round(JET_KT)} kt) by the WMO's definition, usually just below
					the tropopause, where cold polar air meets warmer air. Over Europe it often reaches 100–200
					kt in winter.
				</p>
			{/snippet}
			{#if strongest}
				<p class="mt-2 font-mono text-2xl font-semibold tracking-tight text-green-300">
					{windText(strongest.wind)}
				</p>
				<p class="mt-1 text-xs text-zinc-500">
					at {levelOrFeet(strongest.level)}{strongest.jet ? ': jet stream strength' : ''}.
					{strongest.atTop
						? 'The highest layer with data: it may be stronger above.'
						: strongest.atBottom
							? 'The lowest layer with data: it may be stronger below.'
							: ''}
				</p>
			{:else}
				<p class="mt-2 text-2xl font-semibold tracking-tight text-zinc-500">—</p>
				<p class="mt-1 text-xs text-zinc-500">
					No layer with {MIN_SAMPLES} winds from {MIN_AIRCRAFT} aircraft yet.
				</p>
			{/if}
		</Card>

		<Card heading="h2" title="Sea-level pressure" class="h-36">
			{#snippet info()}
				<p>QNH: the pressure the pilots near the ground set on their altimeters.</p>
			{/snippet}
			<p class="mt-2 text-2xl font-semibold tracking-tight">{hpa(pressure.hPa)}</p>
			<p class="mt-1 text-xs text-zinc-500">
				{pressure.local.length
					? `Median of ${pressure.local.length} aircraft's local settings.`
					: pressure.standard
						? `Assumed standard: ${pressure.standard} aircraft reported a setting, all on 1013.`
						: 'Assumed standard: no aircraft has reported a setting yet.'}
			</p>
		</Card>

		<Card heading="h2" title="Air column" class="h-36" align="right">
			{#snippet info()}
				<p>
					How much warmer or colder than standard the air is on average from the ground up to the
					level shown, from how far the aircraft's GNSS height is from its pressure altitude.
				</p>
			{/snippet}
			{#if example}
				<p class="mt-2 text-2xl font-semibold tracking-tight text-amber-300">
					{isaText(example.column.isaDeviation)}
				</p>
				<p class="mt-1 text-xs text-zinc-500">
					Mean of the air below {levelOrFeet(example.layer.level)}, from {example.layer.column!.n}
					samples.
				</p>
			{:else}
				<p class="mt-2 text-2xl font-semibold tracking-tight text-zinc-500">—</p>
				<p class="mt-1 text-xs text-zinc-500">No GNSS − baro heard yet.</p>
			{/if}
		</Card>
	</section>

	<!-- The three profiles share the altitude axis. -->
	<section class="grid gap-4 lg:grid-cols-3">
		<Card heading="h2" title="Temperature" headClass="mb-2">
			{#snippet info()}
				<p>
					Each layer's mean temperature (dot) and how much the samples differ (bar), against the
					standard atmosphere (dashed). Hollow: fewer than {MIN_SAMPLES} samples, or all from one aircraft.
				</p>
			{/snippet}
			<TemperatureProfile layers={all} tropopause={top} />
			<div class="mt-2 text-xs text-zinc-400">
				<InfoTip label="Contrails" class="font-semibold" wide>
					<p>
						A contrail forms when the engines' hot, wet exhaust cools in the cold air until water
						condenses (the Schmidt–Appleman criterion; Schumann 1996). How cold the air must be
						depends on the pressure and the humidity: the band's right edge is the limit for
						saturated air, the left edge for perfectly dry air, about 10 K colder.
					</p>
					<p>
						Humidity at cruise level is almost never in the data, so in between the answer is the
						humidity the air would need. Near the edges 1 K changes it by 20 points, and aircraft
						read about 2 K cold, so a layer only counts as "any air" or "too warm" with {TEMPERATURE_MARGIN}
						K to spare.
					</p>
					<p class="text-zinc-400">
						For engines that turn {ETA * 100} % of the fuel's energy into thrust; modern ones ({ETA_MODERN *
							100} %) make contrails in air about 1.6 K warmer. The Aircraft tab works it through step
						by step.
					</p>
				</InfoTip>
				<p class="mt-0.5">
					{#each contrails as run, i (run.from)}
						{i ? ' · ' : ''}<span class={run.verdict === 'always' ? 'text-blue-300' : ''}
							>{runText(run)}</span
						>
					{:else}
						No layer with enough temperatures yet.
					{/each}
				</p>
			</div>
		</Card>
		<Card heading="h2" title="Wind" headClass="mb-2">
			{#snippet info()}
				<p>
					Each layer's mean wind speed, with an arrow pointing where the air goes (up is north: an
					arrow to the right is a westerly). The dashed line is jet stream strength.
				</p>
				<p>
					Headings: the winds as the aircraft sent them, or with the headings corrected where the
					heading checks below found one clearly off.
				</p>
			{/snippet}
			{#snippet header()}
				<Segmented
					options={HEADINGS}
					bind:value={correctHeadings}
					prefix="headings"
					class="ml-auto"
				/>
			{/snippet}
			<WindProfile layers={all} {strongest} />
		</Card>
		<Card heading="h2" title="Height − pressure altitude" align="right" headClass="mb-2">
			{#snippet info()}
				<p>
					How far each layer's pressure level really is from where the standard atmosphere puts it
					(after the geoid and geopotential corrections). The guides show what a column with that
					mean deviation from standard would give, at today's QNH: they fan out because each kelvin
					counts for more the more air is below.
				</p>
				<p class="text-zinc-400">
					A dot left of the dashed ISA line: the level is lower than standard, the air below colder
					(or the pressure lower).
				</p>
			{/snippet}
			<ColumnChart
				layers={all}
				{columns}
				qnh={pressure.hPa}
				selected={example?.layer.level ?? null}
			/>
		</Card>
	</section>

	<!-- The numbers behind the profiles. It grows as levels fill in; scroll anchoring keeps
	     the cards below still while they're being read. Picking a layer works its column
	     through below. -->
	<section>
		<h2 class="mb-2 text-sm font-semibold text-zinc-100">Layers</h2>
		<LayerTable
			layers={all}
			{columns}
			tropopause={top}
			{strongest}
			selected={example?.layer.level ?? null}
			onselect={pick}
		/>
	</section>

	<!-- Two columns, each card at its own height: how the column and the pressure are worked
	     out on the left, the checks on the winds on the right. -->
	<section class="grid items-start gap-4 xl:grid-cols-2">
		<div class="space-y-4">
			<div bind:this={columnCard} class="scroll-mt-4">
				{#if example}
					<ColumnCalculation
						layer={example.layer}
						column={example.column}
						qnh={pressure}
						bind:heights
					/>
				{:else}
					<p class="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-500">
						Waiting for GNSS − baro (ADS-B velocity messages, TC 19)…
					</p>
				{/if}
			</div>
			<QnhCard qnh={pressure} now={stream.now} />
		</div>
		<div class="space-y-4">
			<GeostrophicCard {geo} measured={measuredThere} />
			<HeadingCard {checks} {callsigns} correct={correctHeadings} />
			<TurnCard turns={sky.turns} {callsigns} />
		</div>
	</section>
</div>
