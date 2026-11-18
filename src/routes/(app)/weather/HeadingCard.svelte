<!--
	Heading checks (lib/weather/headings.ts): each aircraft's wind against the other
	aircraft's at the same level and time, and the heading correction that would make them
	agree. The switch says whether the profile uses the corrected winds.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { n, signed } from '#lib/describe/format.ts';
	import {
		MAX_LEVEL_FT,
		MAX_TIME_MS,
		MIN_CORRECTION,
		MIN_OTHERS,
		type HeadingCheck
	} from '#lib/weather/headings.ts';

	interface Props {
		checks: Map<string, HeadingCheck>;
		/** Callsigns by address, where known. */
		callsigns: Map<string, string>;
		correct: boolean;
	}

	let { checks, callsigns, correct = $bindable() }: Props = $props();

	/** Clearly off first, then by size. */
	let rows = $derived(
		[...checks.values()].sort(
			(a, b) =>
				Number(b.significant) - Number(a.significant) ||
				Math.abs(b.correction) - Math.abs(a.correction)
		)
	);
	let off = $derived(rows.filter((c) => c.significant).length);

	const CHOICES = [
		{ value: false, label: 'as sent' },
		{ value: true, label: 'corrected' }
	];
</script>

<div class="rounded-lg bg-zinc-900 p-4">
	<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<InfoTip
			heading="h3"
			class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
			label="Heading checks"
			wide
		>
			<p>
				A wind is ground vector − air vector, and the air vector points along the aircraft's
				<strong>heading</strong>: magnetic in register 6,0, turned true with the declination. A
				heading a few degrees off (an outdated magnetic variation table, a compass out of
				calibration) adds a crosswind that isn't there: 8 kt per degree at 450 kt.
			</p>
			<p>
				So each aircraft's wind is compared with the other aircraft's within {n(MAX_LEVEL_FT)}
				ft and {MAX_TIME_MS / 60_000} minutes. Its ground vector minus their wind is the air vector it
				should have flown; the angle from its own to that one is its heading error. Each other aircraft
				counts once, and it needs {MIN_OTHERS} or more: one against one, who'd be wrong?
			</p>
			<p class="text-zinc-400">
				Only corrections of {MIN_CORRECTION}° or more are applied: against weather balloons, the
				check's own estimates were up to 2.2° off. It can't see an error every aircraft shares.
			</p>
		</InfoTip>
		<span class="text-sm text-zinc-500">
			{rows.length
				? `${rows.length} aircraft checked, ${off} clearly off`
				: `no aircraft with ${MIN_OTHERS} others nearby yet`}
		</span>
		<span class="ml-auto inline-flex overflow-hidden rounded text-xs">
			<span class="bg-zinc-950 px-2 py-0.5 text-zinc-500">profile winds</span>
			{#each CHOICES as c (c.label)}
				<button
					class={[
						'px-2 py-0.5',
						correct === c.value ? 'bg-sky-900' : 'bg-zinc-800 hover:bg-zinc-700'
					]}
					onclick={() => (correct = c.value)}
				>
					{c.label}
				</button>
			{/each}
		</span>
	</div>

	{#if rows.length}
		<table class="w-full table-fixed text-sm tabular-nums">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="w-28 py-1 font-normal">Aircraft</th>
					<th class="w-20 py-1 font-normal">Heading</th>
					<th class="w-24 py-1 font-normal">Crosswind</th>
					<th class="w-28 py-1 font-normal">Compared with</th>
					<th class="py-1 font-normal">Off from the others</th>
				</tr>
			</thead>
			<tbody>
				{#each rows.slice(0, 10) as c (c.icao)}
					<tr class="h-7 border-t border-zinc-800">
						<td class="truncate">
							<span class="font-mono text-amber-300">{c.icao}</span>
							<span class="text-zinc-500">{callsigns.get(c.icao) ?? ''}</span>
						</td>
						<td
							class={c.significant ? 'text-amber-300' : 'text-zinc-400'}
							title={c.significant
								? undefined
								: `Under ${MIN_CORRECTION}°: within what the comparison can tell, left as sent`}
						>
							{signed(Math.round(c.correction * 10) / 10 + 0)}°
						</td>
						<td class="text-zinc-400" title="TAS × sin(correction): the wind it made up">
							{Math.abs(c.crosswind).toFixed(0)} kt
						</td>
						<td class="text-zinc-400">{c.others} aircraft</td>
						<td class="text-zinc-400">
							{c.before.toFixed(0)} kt{#if c.significant}
								→ {c.after.toFixed(0)} kt corrected{/if}
							<span class="text-zinc-600">({c.samples} samples)</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<p class="mt-2 text-xs text-zinc-500">
		{correct
			? 'The profile, the layers and the strongest wind use the corrected winds.'
			: 'The profile uses the winds as the aircraft sent them.'}
	</p>
</div>
