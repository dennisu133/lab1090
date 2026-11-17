<!--
	Every aircraft heard in the last minute: the ones on the map, nearest first, then the
	ones without a position. Tap one for its details. The altitude is in the map's colours.
	Aircraft with an alert get its badge next to the name ("7700", "RA ↑"), as on the map.

	The switch in the title row sets the units: NM and kt (aviation's) or km and km/h, for the
	distances and speeds here, the range rings and the panels. Altitudes stay flight levels.

	On a phone the list sits under the map and takes almost half the screen, so its title folds
	it away down to the title row (`open`). From `md` on it's a side panel with room to spare:
	always open, the title is plain text.
-->
<script lang="ts">
	import Flag from '#lib/components/Flag.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { distanceText } from '#lib/describe/aircraft.ts';
	import { badge } from '#lib/describe/alert.ts';
	import { distanceKm, KM_PER_NM } from '#lib/geo.ts';
	import { altitudeCss } from '#lib/map/altitude.ts';
	import { flightLevel, shownPosition, type Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { allocation } from '#lib/modes/nationality.ts';
	import { alertsOf, identing } from '#lib/tracker/alerts.ts';
	import type { TrackedAircraft } from '#lib/tracker/tracker.ts';

	interface Props {
		aircraft: TrackedAircraft[];
		now: number;
		receiver: LatLon;
		/** NM and kt, or km and km/h. */
		unit: Unit;
		/** Unfolded on a phone (below `md`); the side panel from `md` on ignores it. */
		open: boolean;
		onselect: (icao: string) => void;
	}

	let {
		aircraft,
		now,
		receiver,
		unit = $bindable(),
		open = $bindable(),
		onselect
	}: Props = $props();

	const id = $props.id();

	let rows = $derived.by(() => {
		type Row = { a: TrackedAircraft; km: number | null };
		const onMap: Row[] = [];
		const elsewhere: Row[] = [];
		for (const a of aircraft) {
			const shown = shownPosition(a, now);
			const km = shown ? distanceKm(receiver, shown) : null;
			(shown ? onMap : elsewhere).push({ a, km });
		}
		onMap.sort((x, y) => (x.km ?? 0) - (y.km ?? 0) || x.a.icao.localeCompare(y.a.icao));
		return { onMap, elsewhere };
	});

	const altitudeText = (a: TrackedAircraft) =>
		a.position?.surface ? 'GND' : a.altitude ? flightLevel(a.altitude.value) : '–';

	/** Ground speed in the chosen unit; none for aircraft on the ground. */
	const speedText = (a: TrackedAircraft) => {
		if (!a.ground || a.position?.surface) return '';
		const kt = a.ground.value.speed;
		return String(Math.round(unit === 'NM' ? kt : kt * KM_PER_NM));
	};

	const UNITS = [
		{ unit: 'NM', label: 'NM · kt' },
		{ unit: 'km', label: 'km · km/h' }
	] as const;
</script>

{#snippet flag(icao: string)}
	{@const block = allocation(icao)}
	<Flag country={block?.country ?? null} name={block?.state ?? ''} />
{/snippet}

{#snippet row(a: TrackedAircraft, km: number | null)}
	{@const alerts = alertsOf(a, now)}
	<li>
		<button
			type="button"
			onclick={() => onselect(a.icao)}
			class="grid w-full grid-cols-[1fr_3.5rem_3.5rem_4.5rem] items-center gap-x-3 px-4 py-1.5 text-left text-sm hover:bg-zinc-900"
		>
			<span class="flex min-w-0 items-center gap-2">
				{@render flag(a.icao)}
				<!-- On a phone the badges give way, not the name. -->
				<span class={['font-mono text-zinc-100', alerts.length ? 'shrink-0' : 'truncate']}
					>{a.callsign?.value ?? a.icao}</span
				>
				{#each alerts as x (x.kind)}
					<span
						class={[
							'min-w-0 truncate text-xs font-semibold',
							x.tier === 'emergency' ? 'text-red-400' : 'text-amber-300'
						]}>{badge(x)}</span
					>
				{/each}
				{#if identing(a, now)}
					<span class="shrink-0 text-xs text-zinc-300">IDENT</span>
				{/if}
			</span>
			<span
				class="text-right tabular-nums"
				style:color={altitudeCss(a.altitude?.value ?? null, !!a.position?.surface)}
				>{altitudeText(a)}</span
			>
			<span class="text-right text-zinc-400 tabular-nums">{speedText(a)}</span>
			<span class="text-right text-zinc-400 tabular-nums">
				{km === null ? '' : distanceText(km, unit)}
			</span>
		</button>
	</li>
{/snippet}

<div class="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
	<h2 class="font-semibold">
		<button
			type="button"
			onclick={() => (open = !open)}
			aria-expanded={open}
			aria-controls={id}
			class="-my-1 flex items-center gap-2 py-1 md:hidden"
		>
			{aircraft.length} aircraft
			<!-- Like the Layers button's: ^ to unfold, v to fold. -->
			<svg
				viewBox="0 0 10 6"
				class={['h-1.5 w-2.5 text-zinc-400 transition-transform', open && 'rotate-180']}
				aria-hidden="true"
			>
				<path d="M1 5 5 1 9 5" fill="none" stroke="currentColor" stroke-width="1.25" />
			</svg>
		</button>
		<span class="max-md:hidden">{aircraft.length} aircraft</span>
	</h2>
	<div class="flex text-xs text-zinc-400" role="group" aria-label="Units">
		{#each UNITS as u (u.unit)}
			<button
				type="button"
				onclick={() => (unit = u.unit)}
				aria-pressed={unit === u.unit}
				class={[
					'rounded px-1.5 py-0.5',
					unit === u.unit ? 'bg-zinc-700 text-zinc-100' : 'hover:bg-zinc-800'
				]}>{u.label}</button
			>
		{/each}
	</div>
</div>

<div {id} class={[!open && 'max-md:hidden']}>
	<div class="grid grid-cols-[1fr_3.5rem_3.5rem_4.5rem] gap-x-3 px-4 py-1 text-xs text-zinc-500">
		<span>
			<InfoTip label="Flight">
				<p>
					The callsign, or the transponder's 24-bit address until one comes in. The flag: the State
					of registration, which the address alone says (each State has its own block).
				</p>
				<p>
					A code after the name: an alert, red for an emergency (7700, 7600, 7500), amber for an
					ACAS resolution advisory (RA) or a flight asking for priority. IDENT: the pilot pressed
					the button that makes it stand out on the controller's screen.
				</p>
			</InfoTip>
		</span>
		<span class="text-right">
			<InfoTip label="Alt" align="right">
				<p>
					Barometric altitude as a flight level: hundreds of feet in the standard atmosphere, FL350
					= 35,000 ft. GND: on the ground.
				</p>
			</InfoTip>
		</span>
		<span class="text-right">
			<InfoTip label={unit === 'NM' ? 'kt' : 'km/h'} align="right">
				<p>
					Ground speed. Aviation's unit is the knot: a nautical mile per hour, 1 kt = 1.852 km/h.
				</p>
			</InfoTip>
		</span>
		<span class="text-right">Dist</span>
	</div>

	<ul>
		{#each rows.onMap as { a, km } (a.icao)}
			{@render row(a, km)}
		{/each}
	</ul>

	{#if rows.elsewhere.length}
		<div class="px-4 pt-4 pb-1 text-xs text-zinc-500">
			<InfoTip label="Heard, not on the map ({rows.elsewhere.length})">
				<p>
					<strong class="text-zinc-200">No ADS-B:</strong> older transponders only answer radars. A radar
					knows where they are from its antenna's direction and the reply's delay; a receiver that only
					listens doesn't.
				</p>
				<p>
					<strong class="text-zinc-200">ADS-B without a position:</strong> no GPS fix ("no position information",
					TC 0), or at the edge of reception: a position needs an even and an odd message within 10 s.
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
</div>
