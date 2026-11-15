<!--
	The most important alert right now (alerts.svelte.ts), on every page: red for an
	emergency, amber for a caution. One at a time: the others are on the map and in the list,
	and system notifications (if switched on) announce each one as it starts. Clicking it opens
	the aircraft on the tracker, where its panel explains what the alert means and what happens
	next. ✕ hides it until that alert is over; the map keeps showing it.

	It sits just below the navigation bar and stays at the top of the window when you scroll
	(sticky in a zero-height row, so it takes no room from the page).
-->
<script lang="ts">
	import Notice from '#lib/components/Notice.svelte';
	import { headline, nameOf } from '#lib/describe/alert.ts';
	import { getStreams } from './streams';

	const streams = getStreams();
	let alert = $derived(streams.alerts.top);
	let aircraft = $derived(alert && streams.tracker.get(alert.icao));
</script>

{#if alert}
	<div class="sticky top-0 z-30 flex h-0 justify-center">
		<div class="mt-3">
			<Notice tone={alert.tier}>
				<button
					type="button"
					class={[
						'min-w-0 truncate py-1.5 pr-2 pl-4 text-left',
						alert.tier === 'emergency' ? 'hover:bg-red-900' : 'hover:bg-amber-900'
					]}
					onclick={() => streams.show(alert.icao)}
				>
					<span class="font-mono font-semibold">⚠ {nameOf(aircraft, alert.icao)}</span>
					{headline(alert)}
					<span class={alert.tier === 'emergency' ? 'text-red-300' : 'text-amber-300'}>
						· show</span
					>
				</button>
				<button
					type="button"
					class={[
						'shrink-0 px-3',
						alert.tier === 'emergency'
							? 'text-red-300 hover:bg-red-900'
							: 'text-amber-300 hover:bg-amber-900'
					]}
					aria-label="Hide this alert until it's over"
					onclick={() => streams.alerts.dismiss(alert)}>✕</button
				>
			</Notice>
		</div>
	</div>
{/if}
