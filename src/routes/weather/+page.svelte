<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import ReceiverStatus from '#lib/components/ReceiverStatus.svelte';
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
	import AircraftTable from './AircraftTable.svelte';
	import Calculation from './Calculation.svelte';
	import { WeatherStream } from './weather-stream.svelte';

	const FEED_ROWS = 200;

	let { data } = $props();

	const stream = new WeatherStream(() => data.reference);
	$effect(() => stream.connect());

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
	<title>Weather · ADS-B</title>
</svelte:head>

<div class="space-y-6">
	<header
		class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm"
	>
		<ReceiverStatus online={stream.online} update={stream.update} />
		<div class="text-zinc-400">
			<InfoTip label="Weather from aircraft?" wide>
				<p>
					Every airliner carries a small weather station: probes for air pressure and temperature,
					and a navigation system that knows its true path over the ground. Nobody sends us the
					weather, but radars read the aircraft's speeds and heading for air traffic control, in
					registers
					<strong>5,0</strong> and <strong>6,0</strong> (see /comm-b). Those are enough to work out the
					wind and the temperature at the aircraft, for every aircraft the radars talk to.
				</p>
				<p>
					Weather services do exactly this. The Dutch weather service (KNMI) turns the replies
					collected by the air traffic control radars around Amsterdam into wind and temperature
					observations and feeds them into its forecasts: far more of them than weather balloons
					(twice a day, at a few stations) or the reports airlines send themselves (AMDAR) give.
				</p>
				<p class="text-zinc-400">
					Sources: S. de Haan, "High-resolution wind and temperature observations from aircraft
					tracked by Mode-S air traffic control radar", Journal of Geophysical Research (2011). J.
					Sun et al., "Weather field reconstruction using aircraft surveillance data and a novel
					meteo-particle model", PLOS ONE (2018), by the author of pyModeS.
				</p>
			</InfoTip>
		</div>
		<div class="text-zinc-400">
			<InfoTip label="Which replies count" wide>
				<p>
					Only Comm-B replies with a <strong>verified address</strong> ("known" on /frames). A corrupted
					reply looks like it came from a different, made-up aircraft; its numbers would make up a wind.
				</p>
				<p>
					Only registers inferred as <strong>5,0 or 6,0</strong> that nothing the aircraft broadcast via
					ADS-B contradicts (see /comm-b for how). A 6,0 mistaken for a 5,0 would turn a Mach number into
					a ground speed.
				</p>
				<p>
					Each new 5,0 is paired with the aircraft's latest 6,0 and the other way round. The pair is
					an
					<strong>observation</strong>. Its wind is <strong>trusted</strong> if:
				</p>
				<ul class="list-disc space-y-1 pl-5">
					<li>
						the two replies are at most {MAX_SKEW_MS / 1000} s apart, so they describe the same moment,
						and
					</li>
					<li>
						the aircraft banks at most {MAX_ROLL}°. In a turn the heading changes by up to 3° per
						second, and every degree is 8 kt of made-up crosswind. (Without a roll angle in 5,0, its
						track rate decides.)
					</li>
				</ul>
				<p>
					The temperature only needs the first: it doesn't depend on the heading, so turns don't
					matter.
				</p>
				<p class="text-zinc-400">
					Both thresholds come from this receiver's data: in straight flight the wind hardly changed
					with the time between the replies; in turns, 1–3 s apart scattered it by ±10 kt.
				</p>
			</InfoTip>
		</div>
		<div class="text-zinc-400">
			<InfoTip label="How accurate?" wide align="right">
				<p>
					<strong>Rounding</strong>, which we can calculate: the registers round speeds to 2 kt,
					angles to 0.18° and Mach to 0.004. Every value here shows the range that allows: typically
					±2 kt and ±2° for the wind, ±2 K for the temperature at cruise. The one-minute averages
					are better.
				</p>
				<p>
					<strong>Heading</strong>, which we can't: the aircraft converts its true heading to
					magnetic with its own table of the declination, which may be years older than our World
					Magnetic Model. Every 1° of difference is 8 kt of crosswind. Weather services correct this
					per aircraft, against forecasts; we don't have a forecast to compare with.
				</p>
				<p>
					<strong>Timing</strong>: the radar reads whatever was in the register, which the avionics
					update a few times a second. Fine in straight flight, which is why turns are left out.
				</p>
				<p class="text-zinc-400">
					So: trust the averages to a few knots and a degree or two, and wind directions to a few
					degrees. Agreement between aircraft at the same level is the best check.
				</p>
			</InfoTip>
		</div>
	</header>

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
			<button
				class="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
				onclick={() => stream.togglePause()}
			>
				{stream.paused ? `Resume (${stream.held} new)` : 'Pause'}
			</button>
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
