<!--
	The coverage experiment: where this antenna hears aircraft (lib/coverage), on a map of its
	own with the sky plot and the numbers beside it. Laid out like the radar experiment (the
	panel below the map on phones, beside it from `md` on).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Unit } from '#lib/map/features.ts';
	import PageTitle from '../../PageTitle.svelte';
	import { getStreams } from '../../streams';
	import CoverageMap from './CoverageMap.svelte';
	import CoverageOverview from './CoverageOverview.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const stream = getStreams().coverage;

	// Collecting runs from the start (coverage-stream.svelte.ts); the terrain loads now.
	onMount(() => stream.start());

	/** The tracker's NM/km choice (MapLayers.svelte), read only. */
	let unit = $state<Unit>('NM');
	onMount(() => {
		const saved = localStorage.getItem('tracker.unit');
		if (saved === 'NM' || saved === 'km') unit = saved;
	});

	/** The sector picked on the sky plot. */
	let selected = $state<number | null>(null);
</script>

<PageTitle page="Coverage (experimental)" />

{#if data.reference}
	<div class="flex h-full flex-col md:flex-row">
		<div class="relative min-h-0 flex-1">
			<CoverageMap {stream} receiver={data.reference} {unit} {selected} />
		</div>

		<aside
			class="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 pb-4 md:max-h-none md:w-104 md:border-t-0 md:border-l"
		>
			<CoverageOverview {stream} {unit} {selected} onselect={(i) => (selected = i)} />
		</aside>
	</div>
{:else}
	<div class="p-6 text-sm text-zinc-300">
		<h1 class="text-2xl font-semibold">Coverage</h1>
		<p class="mt-2 max-w-2xl">
			Coverage is measured from the receiver: directions, distances and angles all start there. Set
			<code class="text-zinc-100">RECEIVER_POSITION</code> in
			<code class="text-zinc-100">.env</code> (see the README) and restart the server.
		</p>
	</div>
{/if}
