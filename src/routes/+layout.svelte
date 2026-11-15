<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import ReceiverStatus from '#lib/components/ReceiverStatus.svelte';
	import AlertBanner from './AlertBanner.svelte';
	import MessageCounts from './MessageCounts.svelte';
	import NotificationSwitch from './NotificationSwitch.svelte';
	import { setStreams, Streams } from './streams';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/**
	 * Every page's view of the live stream, on one connection, created here so they keep
	 * collecting while you switch pages (streams.ts). Pages get them with getStreams().
	 */
	const streams = setStreams(new Streams(() => data.reference));
	$effect(() => streams.connect());

	const links = [
		{ route: '/', href: resolve('/'), label: 'Tracker' },
		{ route: '/frames', href: resolve('/frames'), label: 'Raw frames' },
		{ route: '/comm-b', href: resolve('/comm-b'), label: 'Comm-B registers' },
		{ route: '/weather', href: resolve('/weather'), label: 'Weather' }
	];

	/**
	 * The data pages are made for wide screens: dense tables, explanations on hover. They
	 * support 1024 px and up (tables scroll sideways below their minimum width); narrower
	 * screens get a notice. The tracker (/) is meant to work on phones too, so it doesn't.
	 */
	const WIDE_ONLY = ['/frames', '/comm-b', '/weather'];

	/** The tracker fills the window below the navigation: a map, no margins, no page scrolling. */
	const fullScreen = $derived(page.route.id === '/');

	/** Is the current page this route or one of its sub-pages (the /weather tabs)? */
	const within = (route: string) =>
		page.route.id === route || (route !== '/' && !!page.route.id?.startsWith(`${route}/`));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- --alert-banner: other notices (PauseButton) float below the alert banner, not over it. -->
<div
	class={[
		'bg-zinc-950 text-zinc-100',
		fullScreen ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-screen'
	]}
	style:--alert-banner={streams.alerts.top ? '3rem' : null}
>
	<nav class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 px-6 py-3">
		<!-- Ten Ninety: 1090 MHz, the frequency of Mode S and ADS-B. -->
		<span class="font-semibold">Ten Ninety</span>
		{#each links as { route, href, label } (route)}
			<a
				{href}
				class={['text-sm hover:text-white', within(route) ? 'text-white' : 'text-zinc-400']}
				aria-current={within(route) ? 'page' : undefined}>{label}</a
			>
		{/each}
		<div class="ml-auto flex items-center gap-6">
			<NotificationSwitch notifications={streams.alerts.notifications} />
			<MessageCounts stats={streams.stats} />
			<ReceiverStatus />
		</div>
	</nav>
	<AlertBanner />
	{#if WIDE_ONLY.some(within)}
		<p
			class="border-b border-amber-900/50 bg-amber-950/40 px-6 py-2 text-sm text-amber-200 lg:hidden"
		>
			Made for wide screens (1024 px and up). On a smaller screen the tables scroll sideways, and
			most explanations only appear when you hover with a mouse.
		</p>
	{/if}
	{#if fullScreen}
		<main class="relative min-h-0 flex-1">
			{@render children()}
		</main>
	{:else}
		<main class="mx-auto max-w-7xl p-6">
			{@render children()}
		</main>
	{/if}
</div>
