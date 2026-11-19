<!--
	/weather: the tabs. The WeatherStream belongs to the root layout
	((app)/streams.ts), so it collects all the time: "Now" needs up to half an hour of data.

	- Now (/weather): the air above the receiver, from all aircraft together.
	- Per aircraft (/weather/aircraft): each aircraft's wind and temperature, worked through.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { children } = $props();

	const tabs = [
		{ href: resolve('/(app)/weather'), label: 'Now' },
		{ href: resolve('/(app)/weather/aircraft'), label: 'Per aircraft' }
	];
</script>

<div class="space-y-6">
	<nav class="flex gap-1 border-b border-zinc-800" aria-label="Weather views">
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

	{@render children()}
</div>
