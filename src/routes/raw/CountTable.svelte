<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';

	interface Row {
		key: number;
		label: string;
		/** Extra info shown after the label, dimmed. */
		detail?: string;
		count: number;
		rate: number;
	}

	interface Props {
		title: string;
		keyLabel: string;
		rows: Row[];
		/** Highlighted row, if any. */
		selected?: number | null;
		/** Makes rows clickable. */
		onselect?: (key: number) => void;
		/** Explanation shown when hovering the title. */
		info?: Snippet;
	}

	let { title, keyLabel, rows, selected = null, onselect, info }: Props = $props();

	let total = $derived(rows.reduce((sum, r) => sum + r.count, 0));
	let max = $derived(Math.max(1, ...rows.map((r) => r.count)));
</script>

<section>
	{#if info}
		<div class="mb-2 flex">
			<InfoTip
				heading="h2"
				class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
				label={title}>{@render info()}</InfoTip
			>
		</div>
	{:else}
		<h2 class="mb-2 text-sm font-semibold tracking-wide text-zinc-400 uppercase">{title}</h2>
	{/if}
	<table class="w-full text-sm tabular-nums">
		<thead class="text-left text-xs text-zinc-500">
			<tr>
				<th class="w-12 py-1 font-normal">{keyLabel}</th>
				<th class="py-1 font-normal">Name</th>
				<th class="w-20 py-1 text-right font-normal">Count</th>
				<th class="w-40 py-1 pl-4 font-normal">Share</th>
				<th class="w-16 py-1 text-right font-normal">/ s</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.key)}
				<tr
					class={[
						'border-t border-zinc-800',
						onselect && 'cursor-pointer hover:bg-zinc-800/60',
						selected === row.key && 'bg-sky-950/60'
					]}
					onclick={() => onselect?.(row.key)}
				>
					<td class="py-1 font-mono">{row.key}</td>
					<td class="py-1">
						{#if onselect}
							<button class="text-left" aria-pressed={selected === row.key}>{row.label}</button>
						{:else}
							{row.label}
						{/if}
						{#if row.detail}
							<span class="ml-1 text-xs text-zinc-500">{row.detail}</span>
						{/if}
					</td>
					<td class="py-1 text-right">{row.count.toLocaleString()}</td>
					<td class="py-1 pl-4">
						<div class="flex items-center gap-2">
							<div class="h-2 flex-1 rounded-sm bg-zinc-800">
								<div
									class="h-2 rounded-sm bg-sky-500"
									style:width="{(row.count / max) * 100}%"
								></div>
							</div>
							<span class="w-12 text-right text-xs text-zinc-400">
								{((row.count / total) * 100).toFixed(1)} %
							</span>
						</div>
					</td>
					<td class="py-1 text-right text-zinc-300">{row.rate.toFixed(1)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
