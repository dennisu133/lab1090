<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const links = [
		{ route: '/', href: resolve('/'), label: 'Home' },
		{ route: '/frames', href: resolve('/frames'), label: 'Raw frames' },
		{ route: '/comm-b', href: resolve('/comm-b'), label: 'Comm-B registers' },
		{ route: '/weather', href: resolve('/weather'), label: 'Weather' }
	];

	/**
	 * The data pages are made for wide screens: dense tables, explanations on hover. They
	 * support 1024 px and up (tables scroll sideways below their minimum width); narrower
	 * screens get a notice. The tracker (/) is meant to work on phones too, so it doesn't.
	 */
	const WIDE_ONLY = new Set(['/frames', '/comm-b', '/weather']);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100">
	<nav class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 px-6 py-3">
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
	{#if page.route.id && WIDE_ONLY.has(page.route.id)}
		<p
			class="border-b border-amber-900/50 bg-amber-950/40 px-6 py-2 text-sm text-amber-200 lg:hidden"
		>
			Made for wide screens (1024 px and up). On a smaller screen the tables scroll sideways, and
			most explanations only appear when you hover with a mouse.
		</p>
	{/if}
	<main class="mx-auto max-w-7xl p-6">
		{@render children()}
	</main>
</div>
