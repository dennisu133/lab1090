<!--
	The Sea-level pressure card's tooltip: what QNH is, and where the value comes from, the
	pressure settings aircraft report on their altimeters (lib/weather/sky.ts). The column
	calculation below uses it.
-->
<script lang="ts">
	import { hpa, levelOrFeet } from '#lib/describe/format.ts';
	import { STANDARD_TOLERANCE, type Qnh } from '#lib/weather/sky.ts';

	let { qnh, now }: { qnh: Qnh; now: number } = $props();

	const age = (rx: number) => {
		const s = Math.max(0, Math.round((now - rx) / 1000));
		return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
	};
</script>

<p>
	Below the <strong>transition altitude</strong> (a few thousand feet in most of Europe, 18,000 ft
	in North America) pilots set their altimeters to the <strong>QNH</strong>, the airfield's pressure
	reduced to sea level, so they read height above sea level. Higher up everyone uses the standard
	<strong>1013.25 hPa</strong>, so all aircraft agree on what "FL350" is.
</p>
<p>
	Aircraft report their setting in register 4,0 (0.1 hPa steps) and ADS-B TC 29 (0.8 hPa steps). A
	setting more than {STANDARD_TOLERANCE} hPa from standard is someone's QNH. The median of each aircraft's
	latest one is used: an average over the area. With none, standard is assumed. Local settings come from
	aircraft climbing out or coming in to land.
</p>
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
					<td class="py-0.5 font-mono text-highlight-300">{s.icao}</td>
					<td class="py-0.5">{s.hPa.toFixed(1)}</td>
					<td class="py-0.5 text-zinc-400">{s.altitude === null ? '—' : levelOrFeet(s.altitude)}</td
					>
					<td class="py-0.5 text-zinc-400">{s.from}</td>
					<td class="py-0.5 text-zinc-500">{age(s.rx)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="text-zinc-400">
		The median is {hpa(qnh.hPa)}. {qnh.standard} other aircraft are on standard (1013.25 hPa).
	</p>
{/if}
