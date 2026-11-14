<!--
	One row per aircraft with 5,0/6,0 pairs: its latest trusted wind and temperature, the
	average over the last minute, and what's wrong with the latest pair if anything.
	Clicking a row shows that aircraft's calculation and filters the feed.
-->
<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		celsius,
		flightLevel,
		signed,
		temperatureFields,
		windFields,
		windText
	} from '#lib/describe/weather.ts';
	import { AIRCRAFT_TTL_MS, AVERAGE_MS, type WeatherAircraft } from '#lib/weather/tracker.ts';

	interface Props {
		aircraft: WeatherAircraft[];
		now: number;
		selected: string | null;
		onselect: (icao: string) => void;
	}

	let { aircraft, now, selected, onselect }: Props = $props();

	const seconds = (rx: number) => `${Math.max(0, Math.round((now - rx) / 1000))} s`;
	const minute = AVERAGE_MS / 1000;
</script>

<section>
	<div class="mb-2 flex">
		<InfoTip
			heading="h2"
			class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
			label="Aircraft"
			wide
		>
			<p>
				Every aircraft a radar read both 5,0 and 6,0 from in the last {AIRCRAFT_TTL_MS / 1000} s, with
				a verified address. Each new reply of one register is paired with the latest of the other: one
				<strong>observation</strong>. Sorted by address, so rows stay put.
			</p>
			<p>
				<strong>Wind</strong> and <strong>Temperature</strong> are the latest trusted values,
				<strong>{minute} s average</strong> the mean of all trusted ones in the last minute (the wind
				as vectors, so 350° and 010° average to 000°, not 180°). An aircraft holds its level for minutes,
				so the average is the more reliable number: it smooths out the rounding steps.
			</p>
			<p class="text-zinc-400">
				Click a row to work through its latest observation below. Hover any value for the
				calculation.
			</p>
		</InfoTip>
	</div>

	<!-- Fixed layout: only Latest pair wraps; every other column has a set width. -->
	<div class="overflow-x-auto lg:overflow-visible">
		<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="w-32 py-1 font-normal xl:w-36">Aircraft</th>
					<th class="w-24 py-1 font-normal">
						<InfoTip label="Altitude">
							<p>
								Pressure altitude: what the altimeter shows with the standard setting (1013.25 hPa),
								from the aircraft's latest verified reply or ADS-B.
							</p>
							<p class="text-zinc-400">
								Shown as a flight level from 18,000 ft: FL370 is 37,000 ft. (Pilots switch to flight
								levels above the transition altitude: 18,000 ft in the US, 5,000 ft in most of
								Germany.) A flight level is really a pressure: FL370 is wherever the air pressure is
								217 hPa.
							</p>
						</InfoTip>
					</th>
					<th class="w-40 py-1 font-normal xl:w-44">
						<InfoTip label="Wind">
							<p>
								Where the wind blows <strong>from</strong> (true north, three digits as in weather reports)
								and its speed, from the latest trusted observation. ± is what the rounding of the register
								values allows.
							</p>
						</InfoTip>
					</th>
					<th class="w-36 py-1 font-normal">
						<InfoTip label="Temperature">
							<p>
								Static air temperature from the latest trusted observation. ± is what the rounding
								of TAS and Mach allows.
							</p>
						</InfoTip>
					</th>
					<th class="w-48 py-1 font-normal">{minute} s average</th>
					<th class="w-16 py-1 font-normal">
						<InfoTip label="ISA">
							<p>
								How much warmer (+) or colder (−) than the standard atmosphere, in °C, averaged over
								the last {minute} s. The standard atmosphere has 15 °C at sea level, 1.98 °C less per
								1,000 ft, and −56.5 °C from 36,089 ft up.
							</p>
							<p>
								For an aircraft that climbs or descends this is the better average: in a minute at
								2,000 ft/min the temperature drops by 4 °C from the height alone, the deviation
								hardly changes. It also makes aircraft at different levels comparable: if they all
								show about the same, they're in the same air mass.
							</p>
						</InfoTip>
					</th>
					<th class="w-20 py-1 text-right font-normal">
						<InfoTip label="Trusted" align="right">
							<p>
								Observations with a trusted wind, out of all since the aircraft appeared here. The
								others had their replies too far apart, or the aircraft was turning.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 font-normal">
						<InfoTip label="Latest pair" align="right">
							<p>
								The aircraft's newest observation: how long ago, and why it wasn't used if it
								wasn't. A turning aircraft keeps its last trusted wind until it flies straight
								again.
							</p>
						</InfoTip>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each aircraft as a (a.icao)}
					{@const avg = a.average}
					{@const problem = a.latest.windProblem ?? a.latest.temperatureProblem}
					<tr
						class={[
							'h-8 cursor-pointer border-t border-zinc-900 hover:bg-zinc-900',
							selected === a.icao && 'bg-sky-950'
						]}
						onclick={() => onselect(a.icao)}
					>
						<td class="py-0.5 whitespace-nowrap">
							<button class="font-mono text-amber-300" aria-pressed={selected === a.icao}>
								{a.icao}
							</button>
							<span class="text-xs text-zinc-500">{a.callsign ?? ''}</span>
						</td>
						<td class="py-0.5">
							{a.latest.inputs.altitude ? flightLevel(a.latest.inputs.altitude.feet) : ''}
						</td>
						<td class="py-0.5">
							{#if a.lastWind}<Fields fields={windFields(a.lastWind)} />{/if}
						</td>
						<td class="py-0.5">
							{#if a.lastTemperature}<Fields fields={temperatureFields(a.lastTemperature)} />{/if}
						</td>
						<td class="py-0.5 whitespace-nowrap">
							{#if avg.wind}
								<span
									class="font-mono"
									title="Mean of {avg.windCount} trusted winds of the last {minute} s, averaged as vectors"
									>{windText(avg.wind)}</span
								>
							{/if}
							{#if avg.kelvin !== null}
								<span
									class="ml-2"
									title="Mean of {avg.temperatureCount} trusted temperatures of the last {minute} s"
									>{celsius(avg.kelvin)}</span
								>
							{/if}
						</td>
						<td class="py-0.5 whitespace-nowrap">
							{#if avg.isaDeviation !== null}
								<span
									class={avg.isaDeviation >= 0 ? 'text-rose-300' : 'text-sky-300'}
									title="Mean deviation from the standard atmosphere of {avg.isaCount} trusted temperatures of the last {minute} s: {avg.isaDeviation.toFixed(
										1
									)} °C"
								>
									{signed(avg.isaDeviation, 0)}
								</span>
							{/if}
						</td>
						<td
							class="py-0.5 text-right text-zinc-400"
							title="{a.trustedWinds} of {a.observations} observations had a trusted wind"
						>
							{a.trustedWinds.toLocaleString()}/{a.observations.toLocaleString()}
						</td>
						<td
							class="truncate py-0.5 text-xs"
							title={problem ?? 'Wind and temperature both trusted'}
						>
							<span class="text-zinc-500">{seconds(a.latest.rx)}</span>
							{#if problem}<span class="text-orange-400">{problem}</span>{:else}<span
									class="text-zinc-400">trusted</span
								>{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="8" class="py-4 text-zinc-500">
							Waiting for a radar to read 5,0 and 6,0 from an aircraft…
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
