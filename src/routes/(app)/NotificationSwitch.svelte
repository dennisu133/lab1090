<!--
	The switch for system notifications, in the navigation bar (lib/system-notifications.svelte.ts):
	the alert banner, as a pop-up from the operating system, for a tab left open in the
	background. Desktop only, so it's hidden on narrow screens, and only where the browser
	offers notifications at all.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { SystemNotifications } from '#lib/system-notifications.svelte.ts';

	let { notifications }: { notifications: SystemNotifications } = $props();

	// Without the API or a secure context (http://pi:1090) the switch isn't shown at all.
	// Blocked is still shown, disabled: the user can unblock it in the site settings.
	let blocked = $derived(notifications.permission === 'denied');
</script>

{#if notifications.permission !== 'unavailable'}
	<div class="hidden items-center gap-2 text-xs text-zinc-400 md:flex">
		<button
			type="button"
			role="switch"
			aria-checked={notifications.on}
			aria-label="System notifications for alerts"
			disabled={blocked}
			onclick={() => notifications.toggle()}
			class={[
				'relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40',
				notifications.on ? 'bg-accent-600' : 'bg-zinc-700 enabled:hover:bg-zinc-600'
			]}
		>
			<span
				class={[
					'absolute top-0.5 left-0.5 size-3 rounded-full bg-zinc-100 motion-safe:transition-transform',
					notifications.on && 'translate-x-3'
				]}
			></span>
		</button>
		<InfoTip label={blocked ? 'Notifications blocked' : 'Notifications'} align="right">
			<p>
				Emergencies (squawk 7500, 7600, 7700), ACAS resolution advisories and priority requests
				(medical, minimum fuel). Only while this tab is open.
			</p>
			{#if blocked}
				<p class="text-warn-300">
					Blocked by your browser. Allow them in the site settings (the icon left of the address).
				</p>
			{/if}
		</InfoTip>
	</div>
{/if}
