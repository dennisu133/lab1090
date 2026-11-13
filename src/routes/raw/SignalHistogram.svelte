<!--
	How strong the received messages are: a histogram of the server's 3 dB signal buckets,
	next to a short guide on reading dBFS.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { SIGNAL_BUCKET_DB, STRONG_SIGNAL_DBFS } from '#lib/modes/frame.ts';

	interface Props {
		/** Message counts keyed by the bucket's lower edge in dBFS. */
		counts: Record<number, number>;
	}

	let { counts }: Props = $props();

	/** Always show at least -42 … 0 dBFS, so the axis doesn't jump around. */
	let bins = $derived.by(() => {
		const keys = Object.keys(counts).map(Number);
		const lowest = Math.min(-42, ...keys);
		const out = [];
		for (let k = lowest; k <= STRONG_SIGNAL_DBFS; k += SIGNAL_BUCKET_DB)
			out.push({ key: k, count: counts[k] ?? 0 });
		return out;
	});
	let total = $derived(bins.reduce((sum, b) => sum + b.count, 0));
	let max = $derived(Math.max(1, ...bins.map((b) => b.count)));
	let strong = $derived(counts[STRONG_SIGNAL_DBFS] ?? 0);
	let median = $derived.by(() => {
		let seen = 0;
		for (const b of bins) if ((seen += b.count) >= total / 2) return b;
	});

	const percent = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

	/** The handful of dB values worth knowing by heart. */
	const reference = [
		{ db: 0, note: 'full scale: the loudest the 8-bit ADC can represent' },
		{ db: -3, note: 'half the power: the practical maximum here (see below)' },
		{ db: -6, note: 'half the amplitude, a quarter of the power' },
		{ db: -10, note: 'a tenth of the power' },
		{ db: -20, note: 'a tenth of the amplitude, a hundredth of the power' },
		{ db: -30, note: 'a thousandth of the power' },
		{ db: -40, note: 'about where messages drown in noise' }
	];
	const share = (db: number) => {
		const amplitude = 10 ** (db / 20) * 100;
		const power = 10 ** (db / 10) * 100;
		const fmt = (p: number) => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2));
		return { amplitude: fmt(amplitude), power: fmt(power) };
	};
</script>

<section class="grid gap-6 lg:grid-cols-2">
	<div>
		<h2 class="mb-2 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
			<InfoTip label="Signal strength">
				<p>
					How loud each message arrived, in 3 dB steps, counted since the server started. Higher
					bars are more messages at that level.
				</p>
				<p>
					Most traffic sits well below full scale: that's the many aircraft far away. The few loud
					messages are from aircraft close to you.
				</p>
				<p>
					<span class="text-rose-400">Red</span> is readsb's "strong signal" range (≥ −3 dBFS). Its auto-gain
					turns the gain down when there are too many of those.
				</p>
			</InfoTip>
		</h2>

		<div class="flex h-36 items-end gap-1 border-b border-zinc-700">
			{#each bins as b (b.key)}
				<div
					class="flex h-full flex-1 flex-col justify-end hover:bg-zinc-800/60"
					title="{b.key} to {b.key +
						SIGNAL_BUCKET_DB} dBFS: {b.count.toLocaleString()} messages ({percent(b.count)} %)"
				>
					<div
						class={[
							'rounded-t-sm',
							b.key >= STRONG_SIGNAL_DBFS ? 'bg-rose-400' : 'bg-sky-500',
							b.count > 0 && 'min-h-px'
						]}
						style:height="{(b.count / max) * 100}%"
					></div>
				</div>
			{/each}
		</div>
		<div class="mt-1 flex gap-1 text-xs text-zinc-500 tabular-nums">
			{#each bins as b (b.key)}
				<!-- a label every 6 dB is plenty -->
				<div class="flex-1">{b.key % 6 === 0 ? b.key : ''}</div>
			{/each}
			<div class="w-0">0</div>
		</div>
		<p class="mt-1 text-right text-xs text-zinc-500">dBFS</p>

		<dl class="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm tabular-nums">
			<div>
				<dt class="inline text-zinc-400">Half the messages are below</dt>
				<dd class="inline">{median ? `${median.key + SIGNAL_BUCKET_DB} dBFS` : '–'}</dd>
			</div>
			<div>
				<dt class="inline text-zinc-400">Strong (≥ −3 dBFS)</dt>
				<dd class="inline">{strong.toLocaleString()} ({percent(strong)} %)</dd>
			</div>
		</dl>
	</div>

	<div class="space-y-3 rounded-lg bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-300">
		<h3 class="font-semibold text-zinc-100">Reading dBFS</h3>
		<p>
			<strong>dBFS</strong> means decibels relative to <em>full scale</em>: how loud a message was
			compared to the loudest signal the dongle can measure. So values are always 0 or negative.
			Decibels are logarithmic: every −10 dB is a tenth of the power.
		</p>
		<table class="w-full text-xs tabular-nums">
			<thead class="text-left text-zinc-500">
				<tr>
					<th class="py-0.5 font-normal">dBFS</th>
					<th class="py-0.5 text-right font-normal">amplitude</th>
					<th class="py-0.5 text-right font-normal">power</th>
					<th class="py-0.5 pl-4 font-normal"></th>
				</tr>
			</thead>
			<tbody>
				{#each reference as r (r.db)}
					{@const s = share(r.db)}
					<tr class="border-t border-zinc-800">
						<td class="py-0.5 font-mono">{r.db}</td>
						<td class="py-0.5 text-right">{s.amplitude} %</td>
						<td class="py-0.5 text-right">{s.power} %</td>
						<td class="py-0.5 pl-4 text-zinc-400">{r.note}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p>
			<strong>Why −3 dBFS is the ceiling:</strong> every Mode S bit is a pulse in one half of a microsecond
			and silence in the other. readsb averages the power over the whole message, gaps included, so even
			pulses at full scale average out at half power.
		</p>
		<p>
			<strong>It's relative to your receiver</strong>, not an absolute power: turning the gain up
			makes everything louder. Good for comparing messages, not for comparing receivers.
		</p>
		<p>
			<strong>As a distance hint:</strong> twice as far is about −6 dB, ten times as far −20 dB. Only
			roughly, though: transponders differ in power (125–500 W) and a banking aircraft can turn its antenna
			away from you.
		</p>
	</div>
</section>
