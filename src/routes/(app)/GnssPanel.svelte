<!--
	Satellite navigation (lib/gnss/watch.ts, the experimental GNSS layer): opens when a cell
	or a change is tapped on the tracker's map. That cell's aircraft or that change first,
	then the aircraft without good navigation now, and every change in the window.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		ago,
		clockTime,
		dayAndTime,
		distanceText,
		interval,
		levelOrFeet,
		n,
		shortTime,
		type Unit
	} from '#lib/describe/format.ts';
	import { bearing, compass, distanceKm } from '#lib/geo.ts';
	import { MAX_RC_M, MIN_NAC_P, type Judgement } from '#lib/gnss/navigation.ts';
	import {
		CELL_KM,
		HOLD,
		MANY_AIRCRAFT,
		MANY_SHARE,
		MIN_AIRCRAFT,
		PLACE_MS,
		WINDOW_MS,
		type Change
	} from '#lib/gnss/watch.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { NAC_P_METRES } from '#lib/modes/integrity.ts';
	import { AIRCRAFT_TTL_MS, type TrackedAircraft } from '#lib/tracker/tracker.ts';
	import type { GnssStream } from './gnss-stream.svelte';
	import PanelHeader from './PanelHeader.svelte';

	interface Props {
		gnss: GnssStream;
		/** The cell or change tapped; null: none. */
		cell: string | null;
		change: number | null;
		/** The aircraft on the map: which can be opened on the tracker. */
		aircraft: TrackedAircraft[];
		now: number;
		receiver: LatLon;
		unit: Unit;
		onselect: (icao: string) => void;
		onfocus: (cell: string | null, change: number | null) => void;
		onclose: () => void;
	}

	let { gnss, cell, change, aircraft, now, receiver, unit, onselect, onfocus, onclose }: Props =
		$props();

	/** Changes listed, newest first. */
	const LISTED = 50;

	let tracked = $derived(new Set(aircraft.map((a) => a.icao)));
	let names = $derived(new Map(gnss.aircraft.map((a) => [a.icao, a.callsign])));
	let focused = $derived(
		change === null ? null : (gnss.changes.find((c) => c.id === change) ?? null)
	);
	let cellInfo = $derived(cell === null ? null : (gnss.cells.find((c) => c.key === cell) ?? null));
	// Re-read with every publish of the cells (the list isn't reactive by itself).
	let cellAircraft = $derived.by(() => {
		void gnss.cells;
		return cell === null ? [] : gnss.cellAircraft(cell);
	});
	let current = $derived(
		gnss.aircraft
			.filter((a) => a.state && a.state !== 'good' && now - a.lastSeen <= AIRCRAFT_TTL_MS)
			.sort((a, b) => a.since - b.since)
	);
	let listed = $derived(gnss.changes.toReversed().slice(0, LISTED));
	let since = $derived(
		gnss.first === null || now - gnss.first >= WINDOW_MS
			? `in the last ${WINDOW_MS / 3_600_000} h`
			: `since ${dayAndTime(gnss.first, shortTime)}`
	);

	const name = (icao: string, callsign: string | null = names.get(icao) ?? null) =>
		callsign ?? icao;

	/** "33 NM SE of the receiver". */
	const where = (at: LatLon) =>
		`${distanceText(distanceKm(receiver, at), unit)} ${compass(bearing(receiver, at))} of the receiver`;

	/** What its messages say: "NIC 0 · NACp 0", "no position (TC 0)". */
	function said(j: Judgement): string {
		if (j.state === 'none') return 'no position (TC 0)';
		const parts = [j.nic === null ? `TC ${j.tc}` : `NIC ${j.nic}`];
		if (j.nacP !== null) parts.push(`NACp ${j.nacP}`);
		return parts.join(' · ');
	}

	/** The loss a regaining ends (the same aircraft's last one before it). */
	function lossBefore(c: Change): Change | null {
		return (
			gnss.changes.findLast((l) => l.icao === c.icao && l.kind === 'lost' && l.t < c.t) ?? null
		);
	}

	const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
</script>

{#snippet who(icao: string, callsign: string | null = null)}
	{#if tracked.has(icao)}
		<button
			type="button"
			class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
			onclick={() => onselect(icao)}>{name(icao, callsign ?? names.get(icao) ?? null)}</button
		>
	{:else}
		<span class="font-mono text-zinc-400">{name(icao, callsign ?? names.get(icao) ?? null)}</span>
	{/if}
{/snippet}

{#snippet mark(kind: Change['kind'])}
	<!-- As on the map: lost a red dot, regained a green ring. -->
	<svg viewBox="0 0 10 10" class="inline size-2.5 shrink-0" aria-hidden="true">
		{#if kind === 'lost'}
			<circle cx="5" cy="5" r="4" class="fill-error-500" />
		{:else}
			<circle cx="5" cy="5" r="3.5" fill="none" class="stroke-ok-400" stroke-width="1.5" />
		{/if}
	</svg>
{/snippet}

<PanelHeader {onclose}>
	<h2 class="text-xl font-semibold">
		Satellite navigation <span class="text-sm font-normal text-warn-300">experimental</span>
	</h2>
	<p class="text-sm text-zinc-400">
		{gnss.totals.aircraft} aircraft placed {since}, {gnss.totals.degraded} of them without good navigation
	</p>
</PanelHeader>

<div class="space-y-3 px-4 pb-3 text-sm text-zinc-300">
	<p>
		Aircraft find their position by satellite (GNSS: GPS, Galileo and others), and every ADS-B
		position they send says how far it can be trusted. The satellites' signal arrives far weaker
		than the noise, so a transmitter on the ground, a jammer, easily drowns it. The aircraft then
		fly on by their own instruments and say so. Where many of them do at once, something interferes.
	</p>
</div>

{#if focused}
	{@const c = focused}
	{@const loss = c.kind === 'regained' ? lossBefore(c) : null}
	<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
		<h3 class="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
			{@render mark(c.kind)}
			{c.kind === 'lost' ? 'Lost here' : 'Back here'}
		</h3>
		<p>
			{@render who(c.icao, c.callsign)}
			{#if c.kind === 'lost'}
				stopped sending good positions at {clockTime(c.t)}{c.altitude === null
					? ''
					: `, at ${levelOrFeet(c.altitude)}`}. Then it sent {c.other === 'none'
					? 'no position at all'
					: 'positions it no longer vouches for'}.
			{:else}
				sent good positions again at {clockTime(c.t)}{loss
					? `, ${ago(c.t - loss.t).replace(' ago', '')} after losing them`
					: ''}.
			{/if}
			{#if c.at}
				The mark is its {c.kind === 'lost' ? 'last good' : 'first good'} position, {where(c.at)}.
			{:else}
				Where is unknown: no position within {PLACE_MS / 1000} s of it.
			{/if}
		</p>
		{#if c.gap > 2000}
			<p class="mt-2 text-zinc-400">
				It wasn't heard for {interval(c.gap)} before: it happened somewhere on that stretch.
			</p>
		{/if}
	</section>
{/if}

{#if cell !== null}
	<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
		<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="This cell">
			<p>
				The map is divided into hexagons about {distanceText(CELL_KM * Math.sqrt(3), unit)} across. Each
				counts the aircraft placed in it over the last {WINDOW_MS / 3_600_000} hours, once each, and how
				many of them were without good navigation there. A cell is drawn once {MIN_AIRCRAFT} aircraft
				were.
			</p>
			<p>
				<strong class="text-ok-400">Green</strong>: all were fine.
				<strong class="text-warn-400">Amber</strong>: some weren't, which can be one aircraft with a
				problem of its own. <strong class="text-error-400">Red</strong>: at least {pct(MANY_SHARE)} and
				{MANY_AIRCRAFT} or more weren't. Interference hits every aircraft in reach alike.
			</p>
		</InfoTip>
		{#if cellInfo}
			<p class="mb-2">
				{cellInfo.aircraft} aircraft here, {cellInfo.degraded} without good navigation.
			</p>
			<ul class="space-y-0.5 tabular-nums">
				{#each cellAircraft as a (a.icao)}
					<li class="flex justify-between gap-4">
						{@render who(a.icao, a.callsign)}
						<span class={a.degraded ? 'text-warn-300' : 'text-zinc-400'}>
							{a.degraded ? 'without' : 'fine'} · {shortTime(a.t)}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-zinc-400">
				No longer counted: its aircraft are more than {WINDOW_MS / 3_600_000} h ago.
			</p>
		{/if}
	</section>
{/if}

<section class="border-t border-zinc-800 px-4 py-3 text-sm">
	<InfoTip
		heading="h3"
		class="mb-2 text-xs font-medium text-zinc-400"
		label="Without good navigation now"
	>
		<p>
			Every airborne position says how far off it may be: the integrity (NIC, a radius the true
			position is guaranteed to be within) and the accuracy (NACp, the 95 % bound). With GNSS an
			airliner sends NIC 7 or more (under {distanceText(MAX_RC_M / 1000, 'NM')}) and NACp {MIN_NAC_P}
			or more (under {n(NAC_P_METRES[MIN_NAC_P]!)} m), the minimum ADS-B must meet in US airspace (14
			CFR 91.227).
		</p>
		<p>
			Below that, or with no position at all (type code 0), the aircraft counts as without. It takes
			{HOLD} messages in a row to change its state, so a single odd one doesn't.
		</p>
	</InfoTip>
	{#if current.length}
		<ul class="space-y-0.5 tabular-nums">
			{#each current as a (a.icao)}
				<li class="flex justify-between gap-4">
					{@render who(a.icao, a.callsign)}
					<span class="text-right text-zinc-400">
						{said(a.judgement)} · {a.wasGood ? `since ${shortTime(a.since)}` : 'since first heard'}
					</span>
				</li>
			{/each}
		</ul>
		{#if current.some((a) => !a.wasGood)}
			<p class="mt-2 text-zinc-400">
				"Since first heard": it came into range like that. It lost GNSS elsewhere, or doesn't use it
				(older and military aircraft), or a receiver confused by false signals (spoofing) earlier in
				the flight stays so until it lands.
			</p>
		{/if}
	{:else}
		<p class="text-zinc-400">Every aircraft heard has good satellite navigation.</p>
	{/if}
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="Changes">
		<p>
			Where aircraft lost good navigation (red dots, at the last good position) and got it back
			(green rings, at the first good one), in the last {WINDOW_MS / 3_600_000} hours. Around a jammer,
			the losses outline the area it reaches. Getting it back comes later than leaving the area: a receiver
			needs half a minute or more to find the satellites again.
		</p>
		<p>
			An amber band under a trail: flown with degraded positions (from the aircraft's inertial
			reference, drifting a mile or two an hour). Dashed: it arrived like that. A red dashed line:
			it sent no positions in between.
		</p>
	</InfoTip>
	{#if listed.length}
		<ul class="space-y-0.5 tabular-nums">
			{#each listed as c (c.id)}
				<li class="flex items-center justify-between gap-4">
					<span class="flex items-center gap-1.5">
						{@render mark(c.kind)}
						<button
							type="button"
							class={[
								'underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300',
								c.id === change ? 'text-accent-300' : 'text-zinc-100'
							]}
							onclick={() => onfocus(null, c.id)}
						>
							{clockTime(c.t)}
						</button>
						<span class="font-mono text-zinc-300">{name(c.icao, c.callsign)}</span>
					</span>
					<span class="text-right text-zinc-400">
						{c.kind === 'lost' ? 'lost' : 'back'} · {c.at
							? `${distanceText(distanceKm(receiver, c.at), unit)} ${compass(bearing(receiver, c.at))}`
							: 'place unknown'}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-zinc-400">No aircraft has lost or regained good navigation within range.</p>
	{/if}
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="What it can't tell">
		<p>
			Where the jammer is: one antenna hears only the aircraft in its own range, so the edge of an
			area beyond them stays unknown, and a jammer's reach depends on its power, its antenna and how
			high the aircraft fly.
		</p>
		<p>
			Spoofing that works: a receiver that believes false signals reports a wrong position as good.
			Only the tracker's speed and range checks catch the worst of those.
		</p>
	</InfoTip>
	<p class="text-zinc-400">
		Collected since the page opened, on every page, kept for {WINDOW_MS / 3_600_000} hours.
	</p>
</section>
