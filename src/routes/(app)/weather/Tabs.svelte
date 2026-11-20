<!--
	/weather's tabs, at the top of each tab's page, with that tab's one-line status on the
	right of the same bar (children) to save a line. The WeatherStream belongs to the root
	layout ((app)/streams.ts), so it collects all the time: the profile needs up to half an
	hour of data.

	- Profile (/weather): the air above the receiver, layer by layer, from all aircraft
	  together over the last half hour.
	- Aircraft (/weather/aircraft): what one aircraft's replies give (its wind, temperature
	  and contrails), worked through.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { children }: { children?: Snippet } = $props();

	const tabs = [
		{ href: resolve('/(app)/weather'), label: 'Profile' },
		{ href: resolve('/(app)/weather/aircraft'), label: 'Aircraft' }
	];
</script>

<div class="flex items-center gap-x-6 border-b border-zinc-800">
	<nav class="flex shrink-0 gap-1" aria-label="Weather views">
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				class={[
					'-mb-px border-b-2 px-4 py-2 text-sm',
					page.url.pathname === tab.href
						? 'border-zinc-100 text-white'
						: 'border-transparent text-zinc-400 hover:text-white'
				]}
				aria-current={page.url.pathname === tab.href ? 'page' : undefined}
			>
				{tab.label}
			</a>
		{/each}
	</nav>
	{#if children}
		<div class="ml-auto min-w-0 text-sm">{@render children()}</div>
	{/if}
</div>
