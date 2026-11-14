<!--
	The sea-level pressure (QNH) the column calculation uses, and where it comes from: the
	pressure settings aircraft report on their altimeters (lib/weather/sky.ts).
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { flightLevel, hpa } from '#lib/describe/weather.ts';
	import { STANDARD_TOLERANCE, type Qnh } from '#lib/weather/sky.ts';

	let { qnh, now }: { qnh: Qnh; now: number } = $props();

	const age = (rx: number) => {
		const s = Math.max(0, Math.round((now - rx) / 1000));
		return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
	};
</script>

<div class="rounded-lg bg-zinc-900 p-4">
	<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<InfoTip heading="h3" class="font-semibold" label="Sea-level pressure (QNH)" wide align="right">
			<p>
				Pilots set their altimeters to the local pressure below the <strong
					>transition altitude</strong
				>
				(5,000 ft over most of Germany), so they read height above sea level near the ground. That setting
				is the <strong>QNH</strong>: the pressure at the airfield, reduced to sea level. Air traffic
				control gives it out on every approach.
			</p>
			<p>
				Higher up, everyone uses the standard <strong>1013.25 hPa</strong>, so all aircraft agree on
				what "FL350" is, whatever the weather. Aircraft report their setting in register 4,0 (0.1
				hPa steps) and ADS-B TC 29 (0.8 hPa steps).
			</p>
			<p>
				So a setting more than {STANDARD_TOLERANCE} hPa from standard is someone's QNH; the median of
				each aircraft's latest one is used. With none, standard is assumed: then every hPa the real QNH
				differs makes about 27 ft of the offset look like temperature.
			</p>
			<p class="text-zinc-400">
				Pressure differs by a few hPa across the receiver's range, so this is an average for the
				area. Some pilots (military fields mostly) set QFE instead, which reads height above the
				runway: such a setting is the airfield's pressure, lower than its QNH.
			</p>
		</InfoTip>
		<span class="text-lg">{hpa(qnh.hPa)}</span>
		<span class="text-sm text-zinc-500">
			{qnh.local.length
				? `median of ${qnh.local.length} aircraft`
				: 'standard, assumed: no local setting heard yet'}
		</span>
	</div>

	{#if qnh.local.length}
		<table class="w-full table-fixed text-sm tabular-nums">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="w-24 py-1 font-normal">Aircraft</th>
					<th class="w-24 py-1 font-normal">Setting</th>
					<th class="w-24 py-1 font-normal">Altitude</th>
					<th class="w-16 py-1 font-normal">From</th>
					<th class="py-1 font-normal">Age</th>
				</tr>
			</thead>
			<tbody>
				{#each qnh.local.slice(0, 8) as s (s.icao)}
					<tr class="border-t border-zinc-800">
						<td class="py-0.5 font-mono text-amber-300">{s.icao}</td>
						<td class="py-0.5">{s.hPa.toFixed(1)}</td>
						<td class="py-0.5 text-zinc-400"
							>{s.altitude === null ? '—' : flightLevel(s.altitude)}</td
						>
						<td class="py-0.5 text-zinc-400">{s.from}</td>
						<td class="py-0.5 text-zinc-500">{age(s.rx)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<p class="mt-2 text-xs text-zinc-500">
		{qnh.standard} aircraft on standard (1013.25 hPa). Local settings come from aircraft near the ground:
		climbing out, or on approach.
	</p>
</div>
