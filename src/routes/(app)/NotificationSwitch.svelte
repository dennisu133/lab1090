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
	// The switch shows on/off; words only for when it can't be used.
	let label = $derived(
		notifications.permission === 'denied'
			? 'Notifications blocked'
			: usable
				? 'Notifications'
				: 'Notifications unavailable'
	);
</script>

<div class="hidden items-center gap-2 text-xs text-zinc-400 md:flex">
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
			Emergencies (squawk 7500, 7600, 7700), ACAS resolution advisories and priority requests
			(medical, minimum fuel). Only while this tab is open.
		</p>
		{#if notifications.permission === 'denied'}
			<p class="text-amber-300">
				Blocked by your browser. Allow them in the site settings (the icon left of the address).
			</p>
		{:else if notifications.permission === 'insecure'}
			<p class="text-amber-300">
				Browsers only allow notifications over HTTPS or on <code>localhost</code>.
			</p>
		{:else if notifications.permission === 'unsupported'}
			<p class="text-amber-300">This browser has no notifications for web pages.</p>
		{/if}
	</InfoTip>
</div>
