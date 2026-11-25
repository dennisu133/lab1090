<!--
	The receiver's state in the navigation bar, one block: "● Live: 57.3 msg/s" (or "Replay:" for
	--replay) over the total
	since the server started. The two links between the antenna and this page, browser ↔
	server (the event stream) and server ↔ receiver (the RTL-SDR, rtl_tcp or a Beast feed), are
	reported to `receiverLink` by the page's stream (receiver-link.svelte.ts); the counts come
	from the server's running count of Mode S frames (every frame that passed the parity
	check), which ReceiverStats turns into a rate over the last 10 s. The rate's tooltip is
	only a chart of its last hour, from the server's 10-second points (RadioHistory), so a
	reload keeps it: the one tooltip on a healthy state (the user's exception, 21 Nov).

	While a link is down the numbers are hidden (they'd be stale or zero): one line says which
	link, its tooltip the reason.

	The demo (DEMO) says when its recording was made instead of the total: counted since the
	page opened, the total says little there.
-->
<script lang="ts">
	import { clockTime, date, dayAndTime, n, perSecond, shortTime } from '#lib/describe/format.ts';
	import { DEMO } from '#lib/demo/mode.ts';
	import HistoryChart from '#lib/components/HistoryChart.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { receiverLink as link } from '#lib/receiver-link.svelte.ts';
	import type { ReceiverStats } from '#lib/receiver-stats.svelte.ts';
	import type { RadioPoint } from '#lib/receiver-types.ts';

	interface Props {
		stats: ReceiverStats;
		/** The server's last hour, oldest first (RadioStream). */
		history: RadioPoint[];
	}

	let { stats, history }: Props = $props();

	let end = $derived(history.at(-1)?.t ?? Date.now());
	let rateSeries = $derived(history.map((p) => ({ t: p.t, value: p.messages / (p.ms / 1000) })));
	/**
	 * From 0 to a round number above the busiest 10 s, in at most 4 steps of 1, 2 or 5 times
	 * a power of ten: 0–200 by 50 here, 0–3,000 by 1,000 at a busy site.
	 */
	let rateRange = $derived.by(() => {
		const high = Math.max(10, ...rateSeries.map((p) => p.value));
		const power = 10 ** Math.floor(Math.log10(high / 4));
		const step = [1, 2, 5, 10].map((m) => m * power).find((s) => high / s <= 4)!;
		const max = Math.ceil(high / step) * step;
		const ticks = [];
		for (let v = 0; v <= max; v += step) ticks.push(v);
		return { max, ticks };
	});

	/**
	 * `receiving`: messages are coming, live or from a file (--replay): the rate and the total
	 * are shown. A replay says so instead of "Live": its aircraft aren't in the sky now.
	 */
	let state = $derived.by(() => {
		const status = link.status;
		if (link.online === false) return { dot: 'bg-zinc-500', label: 'Server offline' };
		if (link.online && status?.state === 'connected')
			return {
				dot: 'motion-safe:animate-pulse bg-ok-400',
				label: link.replay ? 'Replay' : 'Live',
				receiving: true,
				reserve: link.replay ? 'Replay' : 'Live'
			};
		if (link.online && status?.state === 'waiting')
			return { dot: 'bg-warn-400', label: 'Receiver unreachable', waiting: status };
		if (link.online && status?.state === 'ended')
			return { dot: 'bg-zinc-500', label: 'Replay ended', ended: status };
		// The server's page says this, so it takes the room "Live" will take (`reserve`).
		return { dot: 'bg-warn-400', label: 'Connecting…', reserve: 'Live' };
	});
</script>

<!-- Two 16 px lines while live: the logo's height. Right-aligned, against the bar's end.
     While connecting it takes the same room, so going live moves nothing in the bar. -->
<div class="flex flex-col items-end text-xs/4 whitespace-nowrap text-zinc-400 tabular-nums">
	<div class="grid justify-items-end">
		{#if state.reserve}
			<!-- Room for "9,999" kept free, so the rate can grow (99.9 → 100 → 1,000 msg/s) without
			     shifting the rest of the bar: the dot and "Live" move left inside it. The busiest
			     sites decode a few thousand a second: past that, overlapping messages garble the
			     channel, so five digits don't come. -->
			<span class="invisible col-start-1 row-start-1 flex items-center gap-2" aria-hidden="true">
				<span class="size-2.5"></span>
				<span>{state.reserve}: 9,999 msg/s<span class="ml-1 inline-block size-[1em]"></span></span>
			</span>
		{/if}
		<div class="col-start-1 row-start-1 flex items-center gap-2">
			<span class={['size-2.5 shrink-0 rounded-full', state.dot]}></span>
			{#if state.receiving}
				<InfoTip
					label="{state.label}: {perSecond(stats.rates.total)} msg/s"
					class="text-zinc-300"
					align="right"
					wide
				>
					<!-- The chart alone sets the tooltip's width (it's as wide as its content): the
					     widest tooltip's room, or the window's less the tooltip's margins. -->
					<div class="w-[min(37rem,calc(100vw-3.5rem))]">
						<HistoryChart
							series={rateSeries}
							{end}
							min={0}
							max={rateRange.max}
							ticks={rateRange.ticks}
							format={n}
							color="stroke-green-400"
							label="Messages per second over the last hour"
						/>
					</div>
				</InfoTip>
			{:else if state.label === 'Server offline'}
				<InfoTip label={state.label} align="right">
					<p>This page lost its connection to the server. The browser keeps retrying.</p>
				</InfoTip>
			{:else if state.waiting}
				<InfoTip label={state.label} align="right">
					<p>
						The server can't read from {link.source ?? 'the receiver'}: {state.waiting.reason}. Next
						try at {clockTime(state.waiting.retryAt)}.
					</p>
				</InfoTip>
			{:else if state.ended?.reason}
				<InfoTip label={state.label} align="right">
					<p>The server stopped playing {link.source ?? 'the file'}: {state.ended.reason}.</p>
				</InfoTip>
			{:else}
				<span>{state.label}</span>
			{/if}
		</div>
	</div>
	{#if state.receiving && DEMO && link.replay?.recordedAt}
		<span>Recorded {date(link.replay.recordedAt)}</span>
	{:else if state.receiving}
		<span>
			{stats.counts && stats.since !== null
				? `${n(stats.counts.total)} since ${dayAndTime(stats.since, shortTime)}`
				: '–'}
		</span>
	{:else if state.reserve}
		<span class="invisible" aria-hidden="true">–</span>
	{/if}
</div>
