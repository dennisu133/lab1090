<!--
	The most important alert right now (alerts.svelte.ts), on every page: red for an
	emergency, amber for a caution. One at a time: the others are on the map and in the list,
	and system notifications (if switched on) announce each one as it starts. Clicking it opens
	the aircraft on the tracker, where its panel explains what the alert means and what happens
	next. The cross hides it until that alert is over; the map keeps showing it.

	It sits just below the navigation bar and stays at the top of the window when you scroll.
	Over the map it floats (`floating`: sticky in a zero-height row, so it takes no room from
	the map). On the data pages it gets a row of its own instead: floating there, it covered
	section titles and whatever scrolled under it.
-->
<script lang="ts">
	import CloseIcon from '#lib/components/icons/CloseIcon.svelte';
	import WarningIcon from '#lib/components/icons/WarningIcon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import { headline, nameOf } from '#lib/describe/alert.ts';
	import { getStreams } from './streams';

	let { floating }: { floating: boolean } = $props();

	const streams = getStreams();
	let alert = $derived(streams.alerts.top);
	let aircraft = $derived(alert && streams.tracker.get(alert.icao));
</script>

{#if alert}
	<div
		class={[
			'sticky top-0 z-30 flex justify-center',
			floating ? 'h-0' : 'border-b border-zinc-800 bg-zinc-950 px-4 pb-2'
		]}
	>
		<div class={floating ? 'mt-3' : 'mt-2'}>
			<Notice tone={alert.tier}>
				<button
					type="button"
					class={[
						'min-w-0 truncate py-1.5 pr-2 pl-4 text-left',
						alert.tier === 'emergency' ? 'hover:bg-error-900' : 'hover:bg-warn-900'
					]}
					onclick={() => streams.show(alert.icao)}
				>
					<span class="font-mono font-semibold"><WarningIcon /> {nameOf(aircraft, alert.icao)}</span
					>
					{headline(alert)}
					<span class={alert.tier === 'emergency' ? 'text-error-300' : 'text-warn-300'}>
						· show</span
					>
				</button>
				<button
					type="button"
					class={[
						'grid shrink-0 place-items-center pr-3 pl-2.5',
						alert.tier === 'emergency'
							? 'text-error-300 hover:bg-error-900'
							: 'text-warn-300 hover:bg-warn-900'
					]}
					aria-label="Hide this alert until it's over"
					onclick={() => streams.alerts.dismiss(alert)}><CloseIcon /></button
				>
			</Notice>
		</div>
	</div>
{/if}
