<!--
	Message counts per category, with share and rate. Rows with `children` (e.g. a group of
	type codes) expand into sub-rows when their key cell is clicked; clicking anywhere else
	in a row selects it.
-->
<script lang="ts" generics="K extends number | string">
	import { n } from '#lib/describe/format.ts';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { SvelteSet } from 'svelte/reactivity';
	import InfoTip from '#lib/components/InfoTip.svelte';

	interface Row {
		key: K;
		/** Shown in the first column instead of the key. */
		keyText?: string;
		keyClass?: ClassValue;
		label: string;
		/** Tooltip for the label. */
		title?: string;
		count: number;
		rate: number;
		/** Sub-rows, shown when the row is expanded. Their counts are part of this row's. */
		children?: Row[];
	}

	interface Props {
		title: string;
		keyLabel: string;
		rows: Row[];
		/** Highlighted row, if any. */
		selected?: K | null;
		/** Makes rows clickable. */
		onselect?: (key: K) => void;
		/** Explanation shown when hovering the title. */
		info?: Snippet;
	}

	let { title, keyLabel, rows, selected = null, onselect, info }: Props = $props();

	// Shares and bars are relative to the top-level rows; sub-rows use the same scale.
	let total = $derived(rows.reduce((sum, r) => sum + r.count, 0));
	let max = $derived(Math.max(1, ...rows.map((r) => r.count)));

	/** Room for the arrow in the key column, if any row can expand. */
	let expandable = $derived(rows.some((r) => r.children?.length));
	const expanded = new SvelteSet<K>();

	function toggle(key: K) {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
	}
</script>

{#snippet line(row: Row, child: boolean)}
	{@const key = row.keyText ?? row.key}
	<tr
		class={[
			'border-t',
			child ? 'border-zinc-800/50' : 'border-zinc-800',
			selected === row.key ? 'bg-sky-950/60' : child && 'bg-zinc-900/50',
			onselect && 'cursor-pointer hover:bg-zinc-800/60',
			row.count === 0 && 'text-zinc-400'
		]}
		onclick={() => onselect?.(row.key)}
	>
		{#if row.children?.length}
			<!-- The whole key cell expands the row (the rest of the row selects it). -->
			<td class={['p-0 font-mono whitespace-nowrap', row.keyClass]}>
				<button
					class="group/key flex w-full items-center py-1 hover:text-zinc-100"
					aria-expanded={expanded.has(row.key)}
					aria-label="{expanded.has(row.key) ? 'Hide' : 'Show'} {keyLabel} {key} one by one"
					title="{expanded.has(row.key) ? 'Hide' : 'Show'} the codes one by one"
					onclick={(e) => {
						e.stopPropagation(); // expanding is not selecting
						toggle(row.key);
					}}
				>
					<svg
						viewBox="0 0 16 16"
						aria-hidden="true"
						class={[
							'mr-1 size-4 shrink-0 fill-current p-0.5 text-zinc-500 transition-transform group-hover/key:text-zinc-100',
							expanded.has(row.key) && 'rotate-90'
						]}><path d="M5 3l6 5-6 5z" /></svg
					>{key}
				</button>
			</td>
		{:else}
			<td class={['py-1 font-mono whitespace-nowrap', child && 'pl-8', row.keyClass]}>
				{#if expandable && !child}<span class="mr-1 inline-block w-4"></span>{/if}{key}
			</td>
		{/if}
		<td class={['py-1', child && row.count > 0 && 'text-zinc-400']} title={row.title}>
			{#if onselect}
				<button class="text-left" aria-pressed={selected === row.key}>{row.label}</button>
			{:else}
				{row.label}
			{/if}
		</td>
		<td class="py-1 text-right">{n(row.count)}</td>
		<td class="py-1 pl-4">
			<div class="flex items-center gap-2">
				<div class="h-2 flex-1 rounded-sm bg-zinc-800">
					<div
						class={['h-2 rounded-sm', child ? 'bg-sky-700' : 'bg-sky-500']}
						style:width="{(row.count / max) * 100}%"
					></div>
				</div>
				<span class="w-12 text-right text-xs text-zinc-400">
					{total ? ((row.count / total) * 100).toFixed(1) : '0.0'} %
				</span>
			</div>
		</td>
		<td class={['py-1 text-right', row.count > 0 && 'text-zinc-300']}>
			{row.rate.toFixed(1)}
		</td>
	</tr>
{/snippet}

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
	<!-- Fixed layout: only Name takes the remaining width, so changing counts never move the columns.
	     min-w-xl leaves Name room for one line; narrower than that, the table scrolls. -->
	<div class="overflow-x-auto lg:overflow-visible">
		<table class="w-full min-w-xl table-fixed text-sm tabular-nums">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<!-- the arrow column is only there if a row can expand; Share and / s are kept narrow so Name has room -->
					<th class={['py-1 font-normal', expandable ? 'w-18 pl-5' : 'w-14']}>{keyLabel}</th>
					<th class="py-1 font-normal">Name</th>
					<th class="w-20 py-1 text-right font-normal">Count</th>
					<th class="w-32 py-1 pl-4 font-normal">Share</th>
					<th class="w-14 py-1 text-right font-normal">/ s</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.key)}
					{@render line(row, false)}
					{#if expanded.has(row.key)}
						{#each row.children ?? [] as sub (sub.key)}
							{@render line(sub, true)}
						{/each}
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
</section>
