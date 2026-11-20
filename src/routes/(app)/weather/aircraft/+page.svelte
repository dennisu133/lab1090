<script lang="ts">
	import FilterChip from '#lib/components/FilterChip.svelte';
	import Segmented from '#lib/components/Segmented.svelte';
	import LiveHeading from '#lib/components/LiveHeading.svelte';
	import Fields from '#lib/components/Fields.svelte';
	import { arrivalTime, levelOrFeet } from '#lib/describe/format.ts';
	import {
		checkFields,
		inputFields,
		temperatureFields,
		windFields
	} from '#lib/describe/weather.ts';
	import type { Observation } from '#lib/weather/observation.ts';
	import type { WeatherAircraft } from '#lib/weather/tracker.ts';
	import AircraftTable from '../AircraftTable.svelte';
	import ContrailCalculation from '../ContrailCalculation.svelte';
	import TemperatureCalculation from '../TemperatureCalculation.svelte';
	import WindCalculation from '../WindCalculation.svelte';
	import PageTitle from '../../PageTitle.svelte';
	import { getStreams } from '../../streams';

	const FEED_ROWS = 200;

	const stream = getStreams().weather;

	/** The aircraft picked in the table (filters the feed, picks the worked example). */
	let selected = $state<string | null>(null);
	/** An observation frozen in the worked example, so it can be read without it changing. */
	let held = $state.raw<{ observation: Observation; callsign: string | null } | null>(null);

	type Show = 'all' | 'trusted' | 'not used';
	let show = $state<Show>('all');
	const SHOW: { value: Show; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'trusted', label: 'Trusted wind' },
		{ value: 'not used', label: 'Wind not used' }
	];

	/** Without a selection, the example sticks to one aircraft while it keeps sending. */
	const ACTIVE_MS = 10_000;
	/** Bookkeeping for the derived below, not state: which aircraft it picked last time. */
	let picked: string | null = null;

	/**
	 * The worked example: the selected aircraft; else the one picked before, as long as it
	 * sent a pair in the last 10 s; else the first active one with a trusted wind.
	 */
	let example = $derived.by(() => {
		if (held) return held;
		const active = (a: WeatherAircraft) => stream.now - a.lastRx <= ACTIVE_MS;
		const a =
			stream.aircraft.find((a) => a.icao === selected) ??
			stream.aircraft.find((a) => a.icao === picked && active(a)) ??
			stream.aircraft.find((a) => a.lastWind && active(a)) ??
			stream.aircraft.find((a) => a.lastWind) ??
			stream.aircraft[0];
		if (a && a.icao !== selected) picked = a.icao;
		return a ? { observation: a.latest, callsign: a.callsign } : null;
	});

	/** The tracker panel's contrail answer for the example's aircraft, for the third card. */
	let contrail = $derived(stream.contrailFor(example?.observation.icao));

	let feed = $derived(
		stream.items
			.filter(
				(r) =>
					(selected === null || r.observation.icao === selected) &&
					(show === 'all' ||
						(show === 'trusted') === (r.observation.wind !== null && !r.observation.windProblem))
			)
			.slice(0, FEED_ROWS)
	);

	function select(icao: string) {
		selected = selected === icao ? null : icao;
		held = null;
	}
</script>

<PageTitle page="Weather per aircraft" />

<div class="space-y-6">
	<!-- Worked example -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<h2 class="text-sm font-semibold text-zinc-100">Worked example</h2>
			{#if example}
				<span class="text-sm">
					<span class="font-mono text-highlight-300">{example.observation.icao}</span>
					<span class="text-zinc-500">{example.callsign ?? ''}</span>
					{#if example.observation.inputs.altitude}
						<span class="text-zinc-400">
							{levelOrFeet(example.observation.inputs.altitude.feet)}
						</span>
					{/if}
					<span class="text-zinc-500">{arrivalTime(example.observation.rx)}</span>
				</span>
				<button
					class="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
					onclick={() => (held = held ? null : example)}
				>
					{held ? 'Follow live' : 'Hold'}
				</button>
			{/if}
		</div>
		{#if example}
			<!-- One card under the other, each a drawing with the steps beside it: side by side,
			     the steps would be squeezed into a narrow column and the cards would get very
			     tall. Each one checkable with a calculator. -->
			<div class="space-y-4">
				<WindCalculation observation={example.observation} />
				<TemperatureCalculation observation={example.observation} />
				<ContrailCalculation observation={example.observation} tracker={contrail} />
			</div>
		{:else}
			<!-- As tall as the three cards will be, so nothing jumps when the first pair arrives. -->
			<p class="h-266 rounded-lg border border-zinc-800 p-4 text-sm text-zinc-500">
				Waiting for a 5,0/6,0 pair…
			</p>
		{/if}
	</section>

	<AircraftTable aircraft={stream.aircraft} now={stream.now} {selected} onselect={select} />

	<!-- Feed -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<LiveHeading feed={stream} noun="observations" />
			<Segmented options={SHOW} bind:value={show} />
			{#if selected !== null}
				<FilterChip label={selected} onclear={() => (selected = null)} />
			{/if}
		</div>

		<!-- Fixed layout: only Registers wraps. Scrolls only below lg (see /comm-b). -->
		<div class="overflow-x-auto">
			<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
				<thead class="text-left text-xs text-zinc-500">
					<tr>
						<th class="w-28 py-1 font-normal">Received</th>
						<th class="w-32 py-1 font-normal xl:w-36">Aircraft</th>
						<th class="w-20 py-1 font-normal">Altitude</th>
						<th class="w-36 py-1 font-normal xl:w-40">Checks</th>
						<th class="w-40 py-1 font-normal xl:w-44">Wind</th>
						<th class="w-36 py-1 font-normal xl:w-40">Temperature</th>
						<th class="py-1 font-normal">Registers</th>
					</tr>
				</thead>
				<tbody>
					{#each feed as r (r.id)}
						{@const o = r.observation}
						<tr class="border-t border-zinc-900">
							<td class="py-0.5 text-zinc-400">{arrivalTime(o.rx)}</td>
							<td class="py-0.5 whitespace-nowrap">
								<button
									class="font-mono text-highlight-300 hover:underline"
									onclick={() => select(o.icao)}
								>
									{o.icao}
								</button>
								<span class="text-xs text-zinc-500">{r.callsign ?? ''}</span>
							</td>
							<td class="py-0.5 text-zinc-400">
								{o.inputs.altitude ? levelOrFeet(o.inputs.altitude.feet) : ''}
							</td>
							<td class="py-0.5"><Fields fields={checkFields(o)} /></td>
							<td class="py-0.5"><Fields fields={windFields(o)} /></td>
							<td class="py-0.5"><Fields fields={temperatureFields(o)} /></td>
							<td class="py-0.5"><Fields fields={inputFields(o)} /></td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="py-4 text-zinc-500">
								{stream.items.length === 0
									? 'Waiting for 5,0/6,0 pairs…'
									: `None of the last ${stream.items.length} observations match the filter.`}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
