<!--
	How strong the received messages are: a histogram of the server's 3 dB signal buckets,
	next to a short guide on reading dBFS.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { DEMO } from '#lib/demo/mode.ts';
	import { n } from '#lib/describe/format.ts';
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
	/**
	 * Where half the messages are weaker, in bins (2.5 = halfway through the third), assuming
	 * they're spread evenly within a bin. null without messages.
	 */
	let median = $derived.by(() => {
		if (!total) return null;
		let seen = 0;
		for (const [i, b] of bins.entries()) {
			if (seen + b.count >= total / 2) return i + (total / 2 - seen) / b.count;
			seen += b.count;
		}
		return null;
	});

	/** Gap between bars, px (gap-1). */
	const GAP = 4;
	/** CSS position of a point measured in bins, matching the flex layout of the bars. */
	const at = (bin: number) =>
		`calc(${bin} * (100% - ${(bins.length - 1) * GAP}px) / ${bins.length} + ${Math.floor(Math.min(bin, bins.length - 1))} * ${GAP}px)`;

	const percent = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

	/** The handful of dB values worth knowing by heart. */
	const reference = [
		{ db: 0, note: 'full scale: the most the dongle’s 8-bit samples can hold' },
		{ db: -3, note: 'half the power: from here up, messages may have clipped' },
		{ db: -6, note: 'half the amplitude, a quarter of the power' },
		{ db: -10, note: 'a tenth of the power' },
		{ db: -20, note: 'a tenth of the amplitude, a hundredth of the power' },
		{ db: -30, note: 'a thousandth of the power: about the weakest messages heard' },
		{ db: -40, note: 'about the noise, at the default gain' }
	];
	const share = (db: number) => {
		const amplitude = 10 ** (db / 20) * 100;
		const power = 10 ** (db / 10) * 100;
		const fmt = (p: number) => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2));
		return { amplitude: fmt(amplitude), power: fmt(power) };
	};
</script>

<section>
	<div>
		<div class="mb-2 flex">
			<InfoTip
				heading="h2"
				class="text-sm font-semibold text-zinc-100"
				label="Signal strength"
				wide
			>
				<p>
					How strong each message's pulses are, in decibels below <em>full scale</em>: the loudest
					signal the dongle can measure, so always 0 or negative.
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
					Pulses in the <span class="text-error-400">red</span> bucket come close to full scale:
					they may have been too loud for the dongle and got cut off (clipped). A few are harmless;
					many mean the gain is too high. When lab1090 demodulates itself,
					{#if DEMO}the receiver page{:else}<a
							href={resolve('/(app)/receiver')}
							class="text-accent-400 hover:text-accent-300">the receiver page</a
						>{/if} counts the ones that did. A feed from readsb reads about 4.5 dB lower for the same
					message.
				</p>
			</InfoTip>
		</div>

		<div class="relative flex h-32 items-end gap-1 border-b border-zinc-700 pt-4">
			{#if median !== null}
				{@const value = bins[0].key + median * SIGNAL_BUCKET_DB}
				<div
					class="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-zinc-300"
					style:left={at(median)}
				>
					<span class="absolute top-0 left-1 text-xs whitespace-nowrap text-zinc-300"
						>median {n(Math.round(value))}</span
					>
				</div>
			{/if}
			{#each bins as b (b.key)}
				<div
					class="relative flex h-full flex-1 flex-col justify-end hover:bg-zinc-800/60"
					title="{n(b.key)} to {n(b.key + SIGNAL_BUCKET_DB)} dBFS: {n(b.count)} messages ({percent(
						b.count
					)} %)"
				>
					{#if b.key >= STRONG_SIGNAL_DBFS && b.count > 0}
						<!-- the share, on top of the bar: the bar itself is often too short to see -->
						<span
							class="absolute right-0 mb-0.5 text-xs whitespace-nowrap text-error-400"
							style:bottom="{(b.count / max) * 100}%">{percent(b.count)} %</span
						>
					{/if}
					<div
						class={[
							'rounded-t-sm',
							b.key >= STRONG_SIGNAL_DBFS ? 'bg-error-400' : 'bg-blue-500',
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
				<div class="flex-1">{b.key % 6 === 0 ? n(b.key) : ''}</div>
			{/each}
			<div class="w-0">0</div>
		</div>
		<p class="mt-1 text-right text-xs text-zinc-500">dBFS</p>
	</div>
</section>
