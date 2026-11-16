<!--
	How busy the receiver is, in the navigation bar: messages per second and the total since
	the server started. Both come from the server's running count of Mode S frames (every
	frame that passed readsb's parity check); ReceiverStats turns the totals into a rate.
	The total is hidden on phones, where the bar has little room, and from 1024 to 1279 px,
	where the page links share the row with it.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { ReceiverStats } from '#lib/receiver-stats.svelte.ts';

	let { stats }: { stats: ReceiverStats } = $props();

	const clock = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
</script>

<div class="flex items-center gap-4 text-xs text-zinc-400 tabular-nums sm:text-sm">
	<InfoTip label={`${stats.rates.total.toFixed(1)} msg/s`} align="right">
		<p>
			How many Mode S messages arrive per second, averaged over the last 10 s: every frame the Pi
			passed on, from all aircraft in range together, whatever the kind.
		</p>
		<p>
			In the 10-minute test recording it was about 57 per second from 19 aircraft: a fifth ADS-B
			(DF17, which aircraft send on their own), a fifth DF11 (all-call replies and acquisition
			squitters), the rest replies to ground radars (altitude, squawk, Comm-B registers). The rate
			follows the traffic: tens per second by day, close to nothing at night.
		</p>
		<p class="text-zinc-400">
			Worked out in the browser from how the server's running total grows. Raw frames breaks it down
			by downlink format and type code.
		</p>
	</InfoTip>
	<span class="hidden sm:inline lg:hidden xl:inline">
		<InfoTip
			label={stats.counts && stats.since !== null
				? `${stats.counts.total.toLocaleString()} since ${clock.format(stats.since)}`
				: '– messages'}
			align="right"
		>
			<p>
				Every Mode S message the server has received since it started{#if stats.since !== null}
					at <span class="text-zinc-100">{clock.format(stats.since)}</span>{/if}. It keeps one
				connection to the Pi for all browser tabs, so this counts what the antenna heard, not what
				this page has seen.
			</p>
			<p class="text-zinc-400">The count starts over when the server restarts.</p>
		</InfoTip>
	</span>
</div>
