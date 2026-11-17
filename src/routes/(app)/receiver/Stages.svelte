<!--
	What the demodulator does with 2.4 million samples a second (lib/demod/demodulator.ts),
	step by step: how many get through each step per second, and why the rest stop there.
	Rates over the last 10 s; the bars are on a log scale (each step drops orders of magnitude).
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { KNOWN_FOR_S } from '#lib/demod/filter.ts';
	import type { DemodRates } from './radio-stream.svelte';
	import { percent, perSecond } from './format';

	let { rates }: { rates: DemodRates } = $props();

	let preamble = $derived(rates.candidates - rates.noPreamble);
	let format = $derived(preamble - rates.unknownFormat);
	let passed = $derived(rates.accepted + rates.repaired);

	/** Bar width on a log scale from 1/s to the sample rate. */
	const width = (n: number) =>
		`${(Math.max(0, Math.log10(Math.max(n, 1))) / Math.log10(Math.max(rates.samples, 10))) * 100}%`;
	const share = (part: number, whole: number) => (whole > 0 ? percent(part / whole) : '–');
</script>

{#snippet bar(n: number, color: string)}
	<div class="h-2 w-full rounded-sm bg-zinc-800">
		<div class={['h-2 rounded-sm', color]} style:width={width(n)}></div>
	</div>
{/snippet}

<section class="rounded-lg bg-zinc-900 p-4">
	<div class="mb-3 flex">
		<InfoTip
			heading="h2"
			class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
			label="From samples to messages"
			wide
		>
			<p>
				Each step lets through a small part of what reaches it, cheapest first: most samples are
				noise, and only the parity can tell a message from noise that happens to look like one. Per
				second, over the last 10 s. The bars are logarithmic: each mark is ten times the one before.
			</p>
		</InfoTip>
	</div>

	<table class="w-full table-fixed text-sm tabular-nums">
		<thead class="text-left text-xs text-zinc-500">
			<tr>
				<th class="w-44 py-1 font-normal">Step</th>
				<th class="w-24 py-1 text-right font-normal">per second</th>
				<th class="w-20 py-1 text-right font-normal">of above</th>
				<th class="py-1 pl-4 font-normal">stopped here</th>
			</tr>
		</thead>
		<tbody>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Samples">
						<p>
							2.4 million magnitudes a second, one every 0.42 µs: the I/Q pair's length, how much
							signal there is at that moment. A message's half-µs pulses span 1.2 samples.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{perSecond(rates.samples)}</td>
				<td></td>
				<td class="py-1 pl-4">{@render bar(rates.samples, 'bg-zinc-500')}</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Quick test">
						<p>
							Four samples where the preamble's pulses would be, against nine where its gaps would
							be: the pulses must be 1.5× stronger than the gaps and than the noise level. Whole
							samples only, so it's cheap. The samples next to a real preamble often pass too.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{perSecond(rates.candidates)}</td>
				<td class="py-1 text-right text-zinc-400">{share(rates.candidates, rates.samples)}</td>
				<td class="py-1 pl-4">{@render bar(rates.candidates, 'bg-sky-700')}</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Preamble">
						<p>
							Five starts per sample, 0.2 samples (1/12 µs) apart, since a message can start
							anywhere between two samples. A start counts if the energy in its four pulses is twice
							that in its gaps (6 dB).
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{perSecond(preamble)}</td>
				<td class="py-1 text-right text-zinc-400">{share(preamble, rates.candidates)}</td>
				<td class="py-1 pl-4">
					{@render bar(preamble, 'bg-sky-600')}
					<div class="mt-0.5 text-xs text-zinc-500">
						{perSecond(rates.noPreamble)}/s no start looked like a preamble
					</div>
				</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Format">
						<p>
							The first 5 bits are the downlink format (DF). Only 11 of the 25 possible values
							exist; the others mean noise. The format also says how long the message is: 56 or 112
							bits.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{perSecond(format)}</td>
				<td class="py-1 text-right text-zinc-400">{share(format, preamble)}</td>
				<td class="py-1 pl-4">
					{@render bar(format, 'bg-sky-500')}
					<div class="mt-0.5 text-xs text-zinc-500">
						{perSecond(rates.unknownFormat)}/s a format that doesn't exist
					</div>
				</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Parity" wide>
						<p>
							The last 24 bits. ADS-B and DF11 squitters must come out at 0; a single wrong bit in
							ADS-B can be found and flipped back. Replies to radars carry the aircraft's address in
							their parity, so any bits "pass" with some address: they only count from an aircraft
							heard intact within {KNOWN_FOR_S} s. That's where most noise ends: <em>not heard</em>.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{perSecond(passed)}</td>
				<td class="py-1 text-right text-zinc-400">{share(passed, format)}</td>
				<td class="py-1 pl-4">
					{@render bar(passed, 'bg-emerald-500')}
					<div class="mt-0.5 text-xs text-zinc-500">
						{perSecond(rates.parity)}/s parity wrong · {perSecond(rates.unheard)}/s address not
						heard
						{#if rates.repaired > 0}· {perSecond(rates.repaired)}/s passed after a repair{/if}
					</div>
				</td>
			</tr>
		</tbody>
	</table>
</section>
