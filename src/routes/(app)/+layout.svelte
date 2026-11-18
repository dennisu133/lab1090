<script lang="ts">
	import logo from '#lib/assets/logo.svg';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ReceiverStatus from '#lib/components/ReceiverStatus.svelte';
	import AlertBanner from './AlertBanner.svelte';
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
		{ href: resolve('/(app)'), label: 'Tracker' },
		{ href: resolve('/(app)/frames'), label: 'Frames' },
		{ href: resolve('/(app)/comm-b'), label: 'Comm-B registers' },
		{ href: resolve('/(app)/weather'), label: 'Weather' },
		{ href: resolve('/(app)/receiver'), label: 'Receiver' }
	];

	/**
	 * The data pages are made for wide screens: dense tables, explanations on hover. They
	 * support 1024 px and up (tables scroll sideways below their minimum width); narrower
	 * screens get a notice. The tracker (/) is meant to work on phones too, so it doesn't.
	 */
	const WIDE_ONLY = [
		resolve('/(app)/frames'),
		resolve('/(app)/comm-b'),
		resolve('/(app)/weather'),
		resolve('/(app)/receiver')
	];

	/**
	 * The map pages (the tracker) fill the window below the navigation: a map, no margins, no
	 * page scrolling.
	 */
	const FULL_SCREEN: string[] = [resolve('/(app)')];
	const fullScreen = $derived(FULL_SCREEN.includes(page.url.pathname));

	/**
	 * Below `lg` the links don't fit next to the status (the bar would wrap onto two or
	 * three rows, a lot of a phone's map), so they fold into a menu at the right end. It
	 * closes when you pick a page, press Escape or tap anywhere else.
	 */
	let menuOpen = $state(false);
	let nav = $state<HTMLElement>();
	afterNavigate(() => (menuOpen = false));
	const closeOutside = (event: MouseEvent) => {
		// The path, not `target`: the menu button's icon is swapped by the time this runs.
		if (menuOpen && nav && !event.composedPath().includes(nav)) menuOpen = false;
	};
	const closeOnEscape = (event: KeyboardEvent) => {
		if (event.key === 'Escape') menuOpen = false;
	};

	/** Is the current page this one or one of its sub-pages (the /weather tabs)? */
	const within = (href: string) =>
		page.url.pathname === href ||
		(href !== resolve('/(app)') && page.url.pathname.startsWith(`${href}/`));
</script>

<svelte:window onclick={closeOutside} onkeydown={closeOnEscape} />

<!-- --alert-banner: other notices (PauseButton) float below the alert banner, not over it. -->
<div
	class={[
		'bg-zinc-950 text-zinc-100',
		fullScreen ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-screen'
	]}
	style:--alert-banner={streams.alerts.top ? '3rem' : null}
>
	<nav
		bind:this={nav}
		class="relative z-40 flex items-center gap-4 border-b border-zinc-800 px-4 py-3 sm:gap-6 sm:px-6"
	>
		<!-- lab1090: 1090 MHz, the frequency of Mode S and ADS-B. The logo spells it out:
		     "10 90" under radio waves, on an aircraft. -->
		<a href={resolve('/(app)')} class="shrink-0">
			<img src={logo} alt="lab1090" class="h-8 w-auto" />
		</a>
		<div class="hidden items-center gap-6 lg:flex">
			{@render pages('text-sm')}
		</div>
		<div class="ml-auto flex items-center gap-4 sm:gap-6">
			<NotificationSwitch notifications={streams.alerts.notifications} />
			<ReceiverStatus stats={streams.stats} />
		</div>
		<button
			type="button"
			class="-m-1.5 shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white lg:hidden"
			aria-label="Pages"
			aria-expanded={menuOpen}
			aria-controls="page-menu"
			onclick={() => (menuOpen = !menuOpen)}
		>
			<!-- Three bars, or a cross while open. -->
			<svg viewBox="0 0 20 20" class="size-5" aria-hidden="true">
				<g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
					{#if menuOpen}
						<path d="M5 5l10 10M15 5 5 15" />
					{:else}
						<path d="M3 5.5h14M3 10h14M3 14.5h14" />
					{/if}
				</g>
			</svg>
		</button>
		{#if menuOpen}
			<div
				id="page-menu"
				class="absolute top-full right-0 left-0 flex flex-col border-b border-zinc-800 bg-zinc-950 px-4 py-2 shadow-xl sm:left-auto sm:w-64 sm:rounded-bl-lg sm:border-l sm:px-6 lg:hidden"
			>
				{@render pages('py-2.5 text-base')}
			</div>
		{/if}
	</nav>

	{#snippet pages(size: string)}
		{#each links as { href, label } (href)}
			<a
				{href}
				class={[size, 'hover:text-white', within(href) ? 'text-white' : 'text-zinc-400']}
				aria-current={within(href) ? 'page' : undefined}>{label}</a
			>
		{/each}
	{/snippet}
	<AlertBanner floating={fullScreen} />
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
