<script lang="ts">
	import PauseButton from '#lib/components/PauseButton.svelte';
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		checkFields,
		flightLevel,
		inputFields,
		temperatureFields,
		windFields
	} from '#lib/describe/weather.ts';
	import type { Observation } from '#lib/weather/observation.ts';
	import type { WeatherAircraft } from '#lib/weather/tracker.ts';
	import { MAX_ROLL, MAX_SKEW_MS } from '#lib/weather/observation.ts';
	import AircraftTable from '../AircraftTable.svelte';
	import Calculation from '../Calculation.svelte';
	import { getWeatherStream } from '../context';

	const FEED_ROWS = 200;

	const stream = getWeatherStream();

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

	const time = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3,
		hour12: false
	});

	function select(icao: string) {
		selected = selected === icao ? null : icao;
		held = null;
	}
</script>

<svelte:head>
	<title>Weather per aircraft · Ten Ninety</title>
</svelte:head>

<div class="space-y-6">
	<!-- Worked example -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<InfoTip
				heading="h2"
				class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
				label="Worked example"
			>
				<p>
					One observation, step by step, with its own numbers. It follows the aircraft selected in
					the table (else the first with a trusted wind) and updates with every new pair.
				</p>
				<p class="text-zinc-400">Hold it to read it at your own pace.</p>
			</InfoTip>
			{#if example}
				<span class="text-sm">
					<span class="font-mono text-amber-300">{example.observation.icao}</span>
					<span class="text-zinc-500">{example.callsign ?? ''}</span>
					{#if example.observation.inputs.altitude}
						<span class="text-zinc-400">
							{flightLevel(example.observation.inputs.altitude.feet)}
						</span>
					{/if}
					<span class="text-zinc-500">{time.format(example.observation.rx)}</span>
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
			<Calculation observation={example.observation} />
		{:else}
			<!-- As tall as the cards will be, so nothing jumps when the first pair arrives. -->
			<p class="h-176 rounded-lg bg-zinc-900 p-4 text-sm text-zinc-500">
				Waiting for a 5,0/6,0 pair…
			</p>
		{/if}
	</section>

	<AircraftTable aircraft={stream.aircraft} now={stream.now} {selected} onselect={select} />

	<!-- Feed -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<h2 class="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Live observations</h2>
			<PauseButton feed={stream} noun="observations" />
			<div class="flex overflow-hidden rounded text-sm">
				{#each SHOW as s (s.value)}
					<button
						class={['px-3 py-1', show === s.value ? 'bg-sky-900' : 'bg-zinc-800 hover:bg-zinc-700']}
						onclick={() => (show = s.value)}
					>
						{s.label}
					</button>
				{/each}
			</div>
			{#if selected !== null}
				<button
					class="rounded bg-sky-900 px-3 py-1 text-sm hover:bg-sky-800"
					onclick={() => (selected = null)}
				>
					{selected} only ✕
				</button>
			{/if}
		</div>

		<!-- Fixed layout: only Registers wraps. Scrolls only below lg (see /comm-b). -->
		<div class="overflow-x-auto lg:overflow-visible">
			<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
				<thead class="text-left text-xs text-zinc-500">
					<tr>
						<th class="w-28 py-1 font-normal">Received</th>
						<th class="w-32 py-1 font-normal xl:w-36">Aircraft</th>
						<th class="w-20 py-1 font-normal">Altitude</th>
						<th class="w-36 py-1 font-normal xl:w-40">
							<InfoTip label="Checks">
								<p>
									<strong>Δt</strong>: time between the 5,0 and the 6,0 reply, by the receiver's
									clock (12 MHz). At most {MAX_SKEW_MS / 1000} s.
								</p>
								<p>
									<strong>bank</strong>: the roll angle from 5,0. At most {MAX_ROLL}° for the wind.
								</p>
								<p class="text-zinc-400">Orange: this check failed.</p>
							</InfoTip>
						</th>
						<th class="w-40 py-1 font-normal xl:w-44">Wind</th>
						<th class="w-36 py-1 font-normal xl:w-40">Temperature</th>
						<th class="py-1 font-normal">
							<InfoTip label="Registers" align="right">
								<p>
									The register values that go in: ground speed, track and true airspeed from 5,0;
									magnetic heading and Mach from 6,0. Speeds in kt.
								</p>
							</InfoTip>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each feed as r (r.id)}
						{@const o = r.observation}
						<tr class="border-t border-zinc-900">
							<td class="py-0.5 text-zinc-400">{time.format(o.rx)}</td>
							<td class="py-0.5 whitespace-nowrap">
								<button
									class="font-mono text-amber-300 hover:underline"
									title="Show only this aircraft"
									onclick={() => select(o.icao)}
								>
									{o.icao}
								</button>
								<span class="text-xs text-zinc-500">{r.callsign ?? ''}</span>
							</td>
							<td class="py-0.5 text-zinc-400">
								{o.inputs.altitude ? flightLevel(o.inputs.altitude.feet) : ''}
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
