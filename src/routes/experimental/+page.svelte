<!--
	The experiments: methods that worked on the recording (fixtures/capture.beast) but aren't
	trusted enough for the tracker yet, or ideas still being checked. ROADMAP.md (phase 4)
	has the details and what each found so far.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import PageTitle from '../PageTitle.svelte';
	import { getStreams } from '../streams';

	const radars = getStreams().radars;

	const planned = [
		{
			name: 'Coverage',
			text: 'How far this antenna hears in each direction and at each altitude, against the radio horizon; where terrain hides aircraft.'
		},
		{
			name: 'GNSS interference',
			text: 'Where aircraft lose their position integrity (NACp/NIC dropping to 0), as gpsjam.org maps from the same ADS-B fields.'
		},
		{
			name: 'Signal vs distance',
			text: "The received signal against the free-space loss and the elevation angle: the antenna's real pattern. Needs a fixed receiver gain first."
		}
	];
</script>

<PageTitle page="Experimental" />

<h1 class="text-2xl font-semibold">Experimental</h1>
<p class="mt-2 max-w-3xl text-sm text-zinc-400">
	Things this receiver might be able to tell, which aren't trusted yet. Each started as a check on a
	10-minute recording; what works there gets a page here, and stays here until it has held up on
	live traffic for long enough. Nothing here feeds the tracker or the other pages.
</p>

<div class="mt-6 grid max-w-5xl gap-4 md:grid-cols-2">
	<a
		href={resolve('/experimental/radars')}
		class="block rounded-lg border border-zinc-800 p-4 hover:border-zinc-600 hover:bg-zinc-900"
	>
		<h2 class="font-semibold text-zinc-100">Locating the radars</h2>
		<p class="mt-1 text-sm text-zinc-300">
			The ground radars that interrogate the aircraft we hear, placed from the timing of the replies
			alone: each reply names the radar that asked, and a radar only asks while its turning beam
			points at the aircraft.
		</p>
		<p class="mt-2 text-sm text-zinc-500">
			Recording: four radars within 0–11 km of the mapped sites. Live: it piled up radars that were
			nowhere, now held back by stricter checks.
			{#if radars.started !== null}
				<span class="text-zinc-400"
					>Running in this tab: {radars.radars.length}
					{radars.radars.length === 1 ? 'radar' : 'radars'} so far.</span
				>
			{:else}
				<span class="text-zinc-400">Starts listening when you open it.</span>
			{/if}
		</p>
	</a>
	{#each planned as p (p.name)}
		<div class="rounded-lg border border-dashed border-zinc-800 p-4">
			<h2 class="font-semibold text-zinc-400">{p.name}</h2>
			<p class="mt-1 text-sm text-zinc-500">{p.text}</p>
			<p class="mt-2 text-sm text-zinc-600">Not started.</p>
		</div>
	{/each}
</div>
