<!--
	The radar experiment's side panel while no radar is selected: what the experiment does,
	how far it has got (collecting since, radars, candidates), what it takes for a radar to be
	shown, and every code heard.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { ago, distanceText } from '#lib/describe/aircraft.ts';
	import { compass } from '#lib/geo.ts';
	import type { Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import {
		CONFIRM_MS,
		MAX_ELLIPSE_KM,
		MAX_MISSES,
		MIN_AIRCRAFT,
		MIN_BURSTS,
		MIN_PER_AIRCRAFT,
		MIN_SHARE,
		seenFrom,
		type CodeSummary,
		type Radar
	} from '#lib/radar/finder.ts';
	import CodeList from './CodeList.svelte';

	interface Props {
		radars: Radar[];
		candidates: Radar[];
		codes: CodeSummary[];
		/** When collecting started, server clock; null: not yet. */
		started: number | null;
		now: number;
		receiver: LatLon | null;
		unit: Unit;
		onselectradar: (id: string) => void;
	}

	let { radars, candidates, codes, started, now, receiver, unit, onselectradar }: Props = $props();

	const km = (x: number) => distanceText(x, unit);
	const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
	const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
</script>

<header class="px-4 py-3">
	<h2 class="text-xl font-semibold">
		Radars <span class="text-sm text-amber-300">experimental</span>
	</h2>
	<p class="text-sm text-zinc-400">
		{#if started !== null}
			Listening since {ago(now - started).replace(' ago', '')} ·
			{radars.length}
			{radars.length === 1 ? 'radar' : 'radars'} · {candidates.length}
			{candidates.length === 1 ? 'candidate' : 'candidates'}
		{:else}
			Starting…
		{/if}
	</p>
</header>

<div class="space-y-3 px-4 pb-3 text-sm text-zinc-300">
	<p>
		The ground radars that interrogate the aircraft we hear, found from the aircraft's replies
		alone: the antenna never hears a radar itself (radars ask on 1030 MHz, we listen on 1090).
	</p>
	<p>
		A radar's beam turns, and only an aircraft the beam points at gets asked and replies. Each
		all-call reply (DF11) names the radar it answers (its code, e.g. SI 44). So the replies to one
		radar come in bursts, one per turn: their times give the rotation period, and since we know
		where each aircraft was, the moments the beam passed them give where the radar stands. Tap one
		on the map: its panel goes through every step.
	</p>
	<p class="text-zinc-400">
		An experiment: on a 10-minute recording it put four radars within 0–11 km of the sites mapped on
		OpenStreetMap. But a longer run on the dev server also piled up radars that were nowhere, so
		what's shown now has to pass the stricter checks below. The rest of the app doesn't use it.
	</p>
</div>

<section class="border-t border-zinc-800 px-4 py-3 text-sm">
	<InfoTip
		heading="h3"
		class="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
		label="Found"
	>
		<p>
			The radars every fit has found again for {CONFIRM_MS / 60_000} minutes. Distances and directions
			are from the receiver; ± is the uncertainty ellipse's half length (2 standard errors).
		</p>
	</InfoTip>
	{#if radars.length}
		<ul class="space-y-0.5 tabular-nums">
			{#each radars as r (r.id)}
				{@const from = receiver ? seenFrom(r, receiver) : null}
				<li class="flex justify-between gap-4">
					<button
						type="button"
						class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
						onclick={() => onselectradar(r.id)}>{r.id}</button
					>
					<span class="text-zinc-400">
						{(r.period / 1000).toFixed(1)} s
						{#if from}· {km(from.km)} {compass(from.bearing)}{/if}
						· ±{km(r.spread.major)}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-zinc-400">
			None yet. A radar takes a few minutes: enough aircraft must answer it often enough, and then
			it must hold for {CONFIRM_MS / 60_000} more minutes.
		</p>
	{/if}
	{#if candidates.length}
		<ul class="mt-2 space-y-0.5 text-zinc-400 tabular-nums">
			{#each candidates as c (c.id)}
				<li class="flex justify-between gap-4">
					<span class="font-mono">{c.id} <span class="font-sans">(candidate)</span></span>
					<span>shown in {minutes(c.found + CONFIRM_MS - now)} min if it holds</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip
		heading="h3"
		class="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
		label="What it takes"
	>
		<p>
			The first three are against chance: with the recording's burst times shuffled by up to 5 s,
			the best "radar" explains 23 bursts and never {MIN_AIRCRAFT} aircraft with {MIN_PER_AIRCRAFT} each.
		</p>
		<p>
			The last two are what that longer run taught. Each new fit more than 60 km from the last
			counted as another radar, and none ever went: eight on one code, all 4 s, hundreds of km
			apart, most with ellipses hundreds of km long.
		</p>
	</InfoTip>
	<ul class="list-disc space-y-1 pl-5">
		<li>At least {MIN_BURSTS} bursts the fit explains (to within a few degrees of the beam)…</li>
		<li>…from at least {MIN_AIRCRAFT} aircraft with {MIN_PER_AIRCRAFT} or more each…</li>
		<li>…and {pct(MIN_SHARE)} of the bursts on its code (two radars can share one).</li>
		<li>
			An uncertainty ellipse at most {km(MAX_ELLIPSE_KM)} long from the middle: a longer one is a line
			of places it could be, not a place.
		</li>
		<li>
			Found again by every fit (about twice a minute) for {CONFIRM_MS / 60_000} minutes; until then it's
			a candidate, listed but not drawn. A shown radar goes after {MAX_MISSES} fits in a row that find
			other radars on its code but not it.
		</li>
	</ul>
</section>

<CodeList {codes} label="Codes heard" {onselectradar} />
