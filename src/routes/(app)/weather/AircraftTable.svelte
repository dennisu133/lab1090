<!--
	One row per aircraft with 5,0/6,0 pairs: its latest trusted wind and temperature, the
	average over the last minute, and what's wrong with the latest pair if anything.
	Clicking a row shows that aircraft's calculation and filters the feed. The row whose
	calculation is shown is highlighted: brighter when picked here, fainter when the page
	picked it (it follows an active aircraft by itself until one is picked).
-->
<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { celsius, levelOrFeet, n, signed } from '#lib/describe/format.ts';
	import { temperatureFields, windFields, windText } from '#lib/describe/weather.ts';
	import { AIRCRAFT_TTL_MS, AVERAGE_MS, type WeatherAircraft } from '#lib/weather/tracker.ts';

	interface Props {
		aircraft: WeatherAircraft[];
		now: number;
		/** Picked here (and filtering the feed). */
		selected: string | null;
		/** Whose calculation the cards above show: the picked one, or the page's own choice. */
		shown: string | null;
		onselect: (icao: string) => void;
	}

	let { aircraft, now, selected, shown, onselect }: Props = $props();

	const seconds = (rx: number) => `${Math.max(0, Math.round((now - rx) / 1000))} s`;
	const minute = AVERAGE_MS / 1000;
</script>

<section>
	<div class="mb-2 flex">
		<InfoTip heading="h2" class="text-sm font-semibold text-zinc-100" label="Aircraft" wide>
			<p>
				Every aircraft a radar has read registers 5,0 and 6,0 from in the last {AIRCRAFT_TTL_MS /
					1000} s. Each new reply of one is paired with the latest of the other: one
				<strong>observation</strong>. Its wind is <strong>trusted</strong> if it passes the Wind card's
				checks; the temperature only needs the two replies close enough together.
			</p>
			<p class="text-zinc-400">
				Only replies whose address checks out, and that ADS-B doesn't contradict, count: a damaged
				reply can look like it came from a different aircraft.
			</p>
		</InfoTip>
	</div>

	<!-- Fixed layout: only Latest pair wraps; every other column has a set width. -->
	<div class="overflow-x-auto">
		<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="w-32 py-1 font-normal xl:w-36">Aircraft</th>
					<th class="w-24 py-1 font-normal">
						<InfoTip label="Altitude">
							<p>
								<strong>Pressure altitude</strong>: where the standard atmosphere has the pressure
								the aircraft measures, which is what its altimeter shows when set to 1013.25 hPa. It
								isn't quite its height above the sea.
							</p>
							<p class="text-zinc-400">
								From 18,000 ft up it's shown as a flight level, in hundreds of feet: FL370 is 37,000
								ft.
							</p>
						</InfoTip>
					</th>
					<th class="w-40 py-1 font-normal xl:w-44">
						<InfoTip label="Wind">
							<p>
								Where the wind blows <strong>from</strong>, clockwise from true north, and its
								speed, from the latest trusted observation. ± is how many knots the rounding in the
								replies allows.
							</p>
						</InfoTip>
					</th>
					<th class="w-36 py-1 font-normal">
						<InfoTip label="Temperature">
							<p>
								The temperature of the air itself (the probe reads warmer), from the latest trusted
								observation. ± is what the rounding of TAS and Mach allows.
							</p>
						</InfoTip>
					</th>
					<th class="w-48 py-1 font-normal">
						<InfoTip label="{minute} s average">
							<p>
								The mean of the trusted values over the last minute, which smooths out the rounding
								steps. Winds are averaged as arrows: 350° and 010° give 000°, not 180°.
							</p>
						</InfoTip>
					</th>
					<th class="w-16 py-1 font-normal">
						<InfoTip label="ISA">
							<p>
								How much warmer (+) or colder (−) the air is than the standard atmosphere at its
								altitude, over the last {minute} s. Below the tropopause this changes far less with height
								than the temperature itself, so aircraft at different levels can be compared.
							</p>
						</InfoTip>
					</th>
					<th class="w-28 py-1 font-normal">
						<InfoTip label="Trusted">
							<p>
								Observations with a trusted wind, out of all since the aircraft appeared here. The
								rest failed a check: replies too far apart, a turn, or a value missing.
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
							selected === a.icao ? 'bg-accent-950' : shown === a.icao && 'bg-accent-950/70'
						]}
						aria-current={shown === a.icao ? 'true' : undefined}
						onclick={() => onselect(a.icao)}
					>
						<td class="py-0.5 whitespace-nowrap">
							<button class="font-mono text-highlight-300" aria-pressed={selected === a.icao}>
								{a.icao}
							</button>
							<span class="text-xs text-zinc-500">{a.callsign ?? ''}</span>
						</td>
						<td class="py-0.5">
							{a.latest.inputs.altitude ? levelOrFeet(a.latest.inputs.altitude.feet) : ''}
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
									class={avg.wind && 'ml-2'}
									title="Mean of {avg.temperatureCount} trusted temperatures of the last {minute} s"
									>{celsius(avg.kelvin)}</span
								>
							{/if}
						</td>
						<td class="py-0.5 whitespace-nowrap">
							{#if avg.isaDeviation !== null}
								<span
									class={avg.isaDeviation >= 0 ? 'text-red-300' : 'text-blue-300'}
									title="Mean deviation from the standard atmosphere of {avg.isaCount} trusted temperatures of the last {minute} s: {signed(
										avg.isaDeviation
									)} °C"
								>
									{signed(avg.isaDeviation, 0)}
								</span>
							{/if}
						</td>
						<td class="py-0.5 whitespace-nowrap text-zinc-400">
							{n(a.trustedWinds)}/{n(a.observations)}
						</td>
						<td class="truncate py-0.5 text-xs" title={problem ?? undefined}>
							<span class="text-zinc-500">{seconds(a.latest.rx)}</span>
							{#if problem}<span class="text-warn-400">{problem}</span>{:else}<span
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
