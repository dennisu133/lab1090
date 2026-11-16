<!--
	Every radar found so far, at the end of a radar's panel: the ones on the map (tap to open
	one), and the candidates that will be once they hold. With the number of the switch in
	the Layers box, this is how far the search has got.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { distanceText } from '#lib/describe/aircraft.ts';
	import { compass } from '#lib/geo.ts';
	import type { Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { CONFIRM_MS, MAX_MISSES, seenFrom, shownSpread, type Radar } from '#lib/radar/finder.ts';

	interface Props {
		radars: Radar[];
		candidates: Radar[];
		/** The radar whose panel this is: not a link. */
		current: string;
		now: number;
		receiver: LatLon | null;
		unit: Unit;
		onselectradar: (id: string) => void;
	}

	let { radars, candidates, current, now, receiver, unit, onselectradar }: Props = $props();

	const km = (x: number) => distanceText(x, unit);
	const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
</script>

<section class="border-t border-zinc-800 px-4 py-3 text-sm">
	<InfoTip
		heading="h3"
		class="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
		label="All radars"
	>
		<p>
			The radars on the map: every fit has found them again for {CONFIRM_MS / 60_000} minutes. One goes
			after {MAX_MISSES} fits in a row that find other radars on its code but not it. Distances and directions
			are from the receiver; ± is the drawn ellipse's half length.
		</p>
		<p>
			A candidate has been found but not yet for long enough: listed, not drawn. Most of the
			phantoms of an early live run would have stayed candidates and gone.
		</p>
	</InfoTip>
	<ul class="space-y-0.5 tabular-nums">
		{#each radars as r (r.id)}
			{@const from = receiver ? seenFrom(r, receiver) : null}
			<li class="flex justify-between gap-4">
				{#if r.id === current}
					<span class="font-mono text-zinc-100">{r.id}</span>
				{:else}
					<button
						type="button"
						class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
						onclick={() => onselectradar(r.id)}>{r.id}</button
					>
				{/if}
				<span class="text-zinc-400">
					{(r.period / 1000).toFixed(2)} s
					{#if from}· {km(from.km)} {compass(from.bearing)}{/if}
					· ±{km(shownSpread(r).major)}
				</span>
			</li>
		{/each}
		{#each candidates as c (c.id)}
			<li class="flex justify-between gap-4 text-zinc-400">
				<span class="font-mono">{c.id} <span class="font-sans">(candidate)</span></span>
				<span>shown in {minutes(c.found + CONFIRM_MS - now)} min if it holds</span>
			</li>
		{/each}
	</ul>
</section>
