<!--
	The receiver's state in the navigation bar, one block: "● Live: 57.3 msg/s" over the total
	since the server started. The two links between the antenna and this page, browser ↔
	server (the event stream) and server ↔ receiver (the RTL-SDR, rtl_tcp or a Beast feed), are
	reported to `receiverLink` by the page's stream (receiver-link.svelte.ts); the counts come
	from the server's running count of Mode S frames (every frame that passed the parity
	check), which ReceiverStats turns into a rate over the last 10 s.

	While a link is down the numbers are hidden (they'd be stale or zero): one line says which
	link, its tooltip the reason.
-->
<script lang="ts">
	import { clockTime, dayAndTime, n, shortTime } from '#lib/describe/format.ts';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { receiverLink as link } from '#lib/receiver-link.svelte.ts';
	import type { ReceiverStats } from '#lib/receiver-stats.svelte.ts';

	let { stats }: { stats: ReceiverStats } = $props();

	let state = $derived.by(() => {
		const status = link.status;
		if (link.online === false) return { dot: 'bg-zinc-500', label: 'Server offline' };
		if (link.online && status?.state === 'connected')
			return { dot: 'motion-safe:animate-pulse bg-emerald-400', label: 'Live' };
		if (link.online && status?.state === 'waiting')
			return { dot: 'bg-amber-400', label: 'Receiver unreachable', status };
		if (link.online && status?.state === 'ended')
			return { dot: 'bg-zinc-500', label: 'Recording ended' };
		return { dot: 'bg-amber-400', label: 'Connecting…' };
	});
</script>

<!-- Two 16 px lines while live: the logo's height. Right-aligned, against the bar's end. -->
<div class="flex flex-col items-end text-xs/4 whitespace-nowrap text-zinc-400 tabular-nums">
	<div class="grid justify-items-end">
		{#if state.label === 'Live'}
			<!-- Room for "999.9" kept free, so the rate can grow a digit (99 → 100 msg/s) without
			     shifting the rest of the bar: the dot and "Live" move left inside it. -->
			<span class="invisible col-start-1 row-start-1 flex items-center gap-2" aria-hidden="true">
				<span class="size-2.5"></span>Live: 999.9 msg/s
			</span>
		{/if}
		<div class="col-start-1 row-start-1 flex items-center gap-2">
			<span class={['size-2.5 shrink-0 rounded-full', state.dot]}></span>
			{#if state.label === 'Live'}
				<span class="text-zinc-300">Live: {stats.rates.total.toFixed(1)} msg/s</span>
			{:else if state.label === 'Server offline'}
				<InfoTip label={state.label} align="right">
					<p>This page lost its connection to the server. The browser keeps retrying.</p>
				</InfoTip>
			{:else if state.status}
				<InfoTip label={state.label} align="right">
					<p>
						The server can't read from {link.source ?? 'the receiver'}: {state.status.reason}. Next
						try at {clockTime(state.status.retryAt)}.
					</p>
				</InfoTip>
			{:else}
				<span>{state.label}</span>
			{/if}
		</div>
	</div>
	{#if state.label === 'Live'}
		<span>
			{stats.counts && stats.since !== null
				? `${n(stats.counts.total)} since ${dayAndTime(stats.since, shortTime)}`
				: '–'}
		</span>
	{/if}
</div>
