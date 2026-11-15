<!--
	The switch for system notifications, in the navigation bar (lib/system-notifications.svelte.ts):
	the alert banner, as a pop-up from the operating system, for a tab left open in the
	background. Desktop only, so it's hidden on narrow screens.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { SystemNotifications } from '#lib/system-notifications.svelte.ts';

	let { notifications }: { notifications: SystemNotifications } = $props();

	let usable = $derived(
		notifications.permission === 'default' || notifications.permission === 'granted'
	);
	let label = $derived(
		notifications.on
			? 'Notifications on'
			: notifications.permission === 'denied'
				? 'Notifications blocked'
				: usable
					? 'Notifications off'
					: 'Notifications unavailable'
	);
</script>

<div class="hidden items-center gap-2 text-sm text-zinc-400 md:flex">
	<button
		type="button"
		role="switch"
		aria-checked={notifications.on}
		aria-label="System notifications for alerts"
		disabled={!usable}
		onclick={() => notifications.toggle()}
		class={[
			'relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40',
			notifications.on ? 'bg-sky-600' : 'bg-zinc-700 enabled:hover:bg-zinc-600'
		]}
	>
		<span
			class={[
				'absolute top-0.5 left-0.5 size-3 rounded-full bg-zinc-100 transition-transform',
				notifications.on && 'translate-x-3'
			]}
		></span>
	</button>
	<InfoTip {label} align="right">
		<p>
			Alerts as pop-ups from your operating system, for when this tab is in the background or on
			another screen: emergencies (squawk 7500, 7600, 7700 and the ADS-B emergency states), ACAS
			resolution advisories, and flights asking for priority (medical, minimum fuel). The same as
			the banner at the top of the page, one per alert as it starts. Nothing pops up while you're
			looking at this window: the banner is enough then.
		</p>
		{#if notifications.permission === 'denied'}
			<p class="text-amber-300">
				Your browser blocks notifications from this site. It won't ask again on its own, and this
				page can't either; to allow them, change it in the site settings (the icon left of the
				address).
			</p>
		{:else if notifications.permission === 'insecure'}
			<p class="text-amber-300">
				Browsers only allow notifications on secure pages: HTTPS, or this app opened as
				<code>localhost</code>. This page came over plain HTTP from another machine, so it can't use
				them; the banner still works.
			</p>
		{:else if notifications.permission === 'unsupported'}
			<p class="text-amber-300">This browser has no notifications for web pages.</p>
		{:else if notifications.permission === 'default'}
			<p>The first time you switch it on, the browser asks whether to allow them.</p>
		{/if}
		<p class="text-zinc-400">
			Only while this tab is open: there's no server sending them, and no background worker. Desktop
			browsers only; on phones, a tab in the background stops receiving anyway.
		</p>
	</InfoTip>
</div>
