<!--
	The two links between the antenna and this page, in the navigation bar: browser ↔ server
	(the event stream) and server ↔ Pi (the Beast connection). The page's own stream reports
	both to `receiverLink` (see receiver-link.svelte.ts). On phones the bar has room for a
	word only ("Live"); the full sentence then opens the explanation.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { receiverLink as link } from '#lib/receiver-link.svelte.ts';

	let source = $derived(link.source ?? 'the receiver');

	let state = $derived.by(() => {
		const status = link.status;
		if (link.online === false)
			return { dot: 'bg-zinc-500', label: 'Server stream offline, retrying…', short: 'Offline' };
		if (link.online && status?.state === 'connected')
			return {
				dot: 'animate-pulse bg-emerald-400',
				label: `Receiving from ${source}`,
				short: 'Live'
			};
		if (link.online && status?.state === 'waiting')
			return { dot: 'bg-amber-400', label: 'Receiver unreachable', short: 'Unreachable' };
		return { dot: 'bg-amber-400', label: `Connecting to ${source}…`, short: 'Connecting…' };
	});
</script>

<div class="flex items-center gap-2 text-xs text-zinc-400 sm:text-sm">
	<span class={['size-2.5 shrink-0 rounded-full', state.dot]}></span>
	<span class="sm:hidden">
		<InfoTip label={state.short} align="right">
			<p class="text-zinc-100">{state.label}.</p>
			{@render explanation()}
		</InfoTip>
	</span>
	<span class="hidden sm:inline">
		<InfoTip label={state.label} align="right">{@render explanation()}</InfoTip>
	</span>
</div>

{#snippet explanation()}
	<p>
		Two links bring the aircraft to this page. The Raspberry Pi with the antenna runs
		<strong>readsb</strong>, which turns the radio signal into frames, checks their parity and
		streams them raw over TCP in the <strong>Beast</strong> format (port 30005). This app's server holds
		the one connection to it.
	</p>
	<p>
		The server only checks each frame's CRC and address, counts them and passes them on to your
		browser four times a second (a Server-Sent Events stream). Everything you see decoded is decoded
		here in the browser, from the raw bits.
	</p>
	<p>
		<span class="text-emerald-400">●</span> both links up,
		<span class="text-amber-400">●</span> the server can't reach the Pi (it retries on its own),
		<span class="text-zinc-500">●</span> the browser lost the server (it retries too).
	</p>
	{#if link.online && link.status?.state === 'waiting'}
		<p class="text-zinc-400">
			Last attempt: {link.status.reason}. Next try in {(link.status.retryInMs / 1000).toFixed(0)} s.
		</p>
	{/if}
{/snippet}
