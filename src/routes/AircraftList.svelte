<!--
	Every aircraft heard in the last minute: the ones on the map, nearest first, then the
	ones without a position. Tap one for its details.
-->
<script lang="ts">
	import Flag from '#lib/components/Flag.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { distanceText } from '#lib/describe/aircraft.ts';
	import { distanceKm } from '#lib/geo.ts';
	import { altitudeCss } from '#lib/map/altitude.ts';
	import { flightLevel, shownPosition, type Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { allocation } from '#lib/modes/nationality.ts';
	import type { TrackedAircraft } from '#lib/tracker/tracker.ts';

	interface Props {
		aircraft: TrackedAircraft[];
		now: number;
		receiver: LatLon | null;
		unit: Unit;
		onselect: (icao: string) => void;
	}

	let { aircraft, now, receiver, unit, onselect }: Props = $props();

	let rows = $derived.by(() => {
		type Row = { a: TrackedAircraft; km: number | null };
		const onMap: Row[] = [];
		const elsewhere: Row[] = [];
		for (const a of aircraft) {
			const shown = shownPosition(a, now);
			const km = shown && receiver ? distanceKm(receiver, shown) : null;
			(shown ? onMap : elsewhere).push({ a, km });
		}
		onMap.sort((x, y) => (x.km ?? 0) - (y.km ?? 0) || x.a.icao.localeCompare(y.a.icao));
		return { onMap, elsewhere };
	});

	const altitudeText = (a: TrackedAircraft) =>
		a.position?.surface ? 'GND' : a.altitude ? flightLevel(a.altitude.value) : '–';
</script>

{#snippet flag(icao: string)}
	{@const block = allocation(icao)}
	<Flag country={block?.country ?? null} name={block?.state ?? ''} />
{/snippet}

{#snippet row(a: TrackedAircraft, km: number | null)}
	<li>
		<button
			type="button"
			onclick={() => onselect(a.icao)}
			class="grid w-full grid-cols-[0.5rem_1fr_3.5rem_3.5rem_4.5rem] items-center gap-x-3 px-4 py-1.5 text-left text-sm hover:bg-zinc-900"
		>
			<span
				class="size-2 rounded-full"
				style:background-color={altitudeCss(a.altitude?.value ?? null, !!a.position?.surface)}
			></span>
			<span class="flex min-w-0 items-center gap-2">
				{@render flag(a.icao)}
				<span class="truncate font-mono text-zinc-100">{a.callsign?.value ?? a.icao}</span>
			</span>
			<span class="text-right text-zinc-300 tabular-nums">{altitudeText(a)}</span>
			<span class="text-right text-zinc-400 tabular-nums">
				{a.ground && !a.position?.surface ? Math.round(a.ground.value.speed) : ''}
			</span>
			<span class="text-right text-zinc-400 tabular-nums">
				{km === null ? '' : distanceText(km, unit)}
			</span>
		</button>
	</li>
{/snippet}

<div class="px-4 pt-3 pb-1">
	<h2 class="font-semibold">
		<InfoTip label="{aircraft.length} aircraft">
			<p>
				Everything heard in the last minute: aircraft broadcasting ADS-B, and aircraft replying to
				radars whose address could be checked. An aircraft disappears after a minute without a
				message.
			</p>
		</InfoTip>
	</h2>
</div>

<div
	class="grid grid-cols-[0.5rem_1fr_3.5rem_3.5rem_4.5rem] gap-x-3 px-4 py-1 text-xs text-zinc-500"
>
	<span></span>
	<span>
		<InfoTip label="Flight">
			<p>
				The callsign (airline code + flight number), or the transponder's 24-bit address while no
				callsign has come in.
			</p>
			<p>
				The flag: the State the aircraft is registered in. Each State has its own block of addresses
				(ICAO Annex 10), so the address alone says it. Not necessarily the airline's country: leased
				aircraft often keep a foreign registration.
			</p>
		</InfoTip>
	</span>
	<span class="text-right">
		<InfoTip label="Alt" align="right">
			<p>
				Barometric altitude as a flight level: hundreds of feet in the standard atmosphere, FL350 =
				35,000 ft. GND: on the ground. The dot has the aircraft's colour on the map.
			</p>
		</InfoTip>
	</span>
	<span class="text-right">
		<InfoTip label="kt" align="right">
			<p>Ground speed in knots (nautical miles per hour; 1 kt = 1.852 km/h).</p>
		</InfoTip>
	</span>
	<span class="text-right">
		<InfoTip label="Dist" align="right">
			<p>Distance from the receiver, along the great circle.</p>
		</InfoTip>
	</span>
</div>

<ul>
	{#each rows.onMap as { a, km } (a.icao)}
		{@render row(a, km)}
	{/each}
</ul>

{#if rows.elsewhere.length}
	<div class="px-4 pt-4 pb-1 text-xs text-zinc-500">
		<InfoTip label="Heard, not on the map ({rows.elsewhere.length})">
			<p>Aircraft we hear but can't place:</p>
			<p>
				<strong class="text-zinc-200">No ADS-B:</strong> older transponders only answer radars (altitude,
				squawk). A ground radar knows where they are from its antenna's direction and the reply's delay;
				a receiver that only listens doesn't.
			</p>
			<p>
				<strong class="text-zinc-200">ADS-B without a position:</strong> some send "no position information"
				(TC 0), e.g. without a GPS fix. Others are just at the edge of reception: a position needs an
				even and an odd message within 10 s.
			</p>
			<p>
				<strong class="text-zinc-200">Not confirmed yet:</strong> a first position is only drawn once
				the next one agrees with it.
			</p>
		</InfoTip>
	</div>
	<ul>
		{#each rows.elsewhere as { a, km } (a.icao)}
			{@render row(a, km)}
		{/each}
	</ul>
{/if}
