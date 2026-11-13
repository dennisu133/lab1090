<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const links = [
		{ route: '/', href: resolve('/'), label: 'Home' },
		{ route: '/raw', href: resolve('/raw'), label: 'Raw frames' },
		{ route: '/comm-b', href: resolve('/comm-b'), label: 'Comm-B registers' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100">
	<nav class="flex items-center gap-6 border-b border-zinc-800 px-6 py-3">
		<span class="font-semibold">ADS-B</span>
		{#each links as { route, href, label } (route)}
			<a
				{href}
				class={[
					'text-sm hover:text-white',
					page.route.id === route ? 'text-white' : 'text-zinc-400'
				]}
				aria-current={page.route.id === route ? 'page' : undefined}>{label}</a
			>
		{/each}
	</nav>
	<main class="mx-auto max-w-7xl p-6">
		{@render children()}
	</main>
</div>
