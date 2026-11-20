<!--
	The radar codes heard in the replies lately, with the radars found on each: confirmed
	ones to tap, candidates named. At the end of a radar's panel, minus its own code.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { plural } from '#lib/describe/format.ts';
	import { WINDOW_MS, type CodeSummary } from '#lib/radar/finder.ts';

	interface Props {
		codes: CodeSummary[];
		label: string;
		onselectradar: (id: string) => void;
	}

	let { codes, label, onselectradar }: Props = $props();

	/** Codes with fewer bursts aren't listed (one by one, they say nothing). */
	const LISTED_BURSTS = 10;

	let listed = $derived(
		codes.filter((c) => c.bursts >= LISTED_BURSTS || c.radars.length || c.candidates.length)
	);
	let unlisted = $derived(codes.length - listed.length);
</script>

{#if listed.length || unlisted}
	<section class="border-t border-zinc-800 px-4 py-3 text-sm">
		<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" {label}>
			<p>
				The radar codes in the replies of the last {WINDOW_MS / 60_000} minutes with at least {LISTED_BURSTS}
				bursts. Most are never placed: too few aircraft answer them often enough, or too few of those
				have an ADS-B position.
			</p>
			<p>
				Codes with fewer bursts are left out: some aren't even radars. The code is what's left of
				the parity field after the CRC, so a flipped bit there can't be caught and names a code
				nobody used.
			</p>
		</InfoTip>
		<ul class="space-y-0.5 tabular-nums">
			{#each listed as c (c.code)}
				<li class="flex justify-between gap-4">
					<span class="flex flex-wrap gap-x-2">
						{#each c.radars as id (id)}
							<button
								type="button"
								class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
								onclick={() => onselectradar(id)}>{id}</button
							>
						{/each}
						{#each c.candidates as id (id)}
							<span class="font-mono text-zinc-400"
								>{id} <span class="font-sans">(candidate)</span></span
							>
						{/each}
						{#if !c.radars.length && !c.candidates.length}
							<span class="font-mono text-zinc-400">{c.code}</span>
						{/if}
					</span>
					<span class="shrink-0 text-zinc-500"
						>{plural(c.bursts, 'burst')} · {c.aircraft} aircraft</span
					>
				</li>
			{/each}
		</ul>
		{#if unlisted}
			<p class="mt-1 text-zinc-500">
				And {plural(unlisted, 'code')} with fewer than {LISTED_BURSTS} bursts.
			</p>
		{/if}
	</section>
{/if}
