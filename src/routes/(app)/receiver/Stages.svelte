<!--
	What the demodulator does with 2.4 million samples a second (lib/demod/demodulator.ts),
	step by step: how many get through each step per second, and why the rest stop there.
	Rates over the last 10 s; the bars are on a log scale (each step drops orders of magnitude).

	Rows keep their height while the rates change, or the rest of the page would jump: every
	reason is always there (also at 0/s), on its own line, and the narrow Step column leaves
	those lines room enough not to wrap at 1280 px, where this panel is half the page. For the
	same reason it's there before the rates are (`null`: a window takes a second or two), with
	"–" and empty bars.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { KNOWN_FOR_S } from '#lib/demod/filter.ts';
	import type { DemodRates } from './radio-stream.svelte';
	import { perSecond } from '#lib/describe/format.ts';
	import { percent } from './format';

	let { rates: measured }: { rates: DemodRates | null } = $props();

	/** Not measured yet: NaN, which the sums below keep and the formatters show as "–". */
	const UNMEASURED: DemodRates = {
		samples: NaN,
		candidates: NaN,
		noPreamble: NaN,
		unknownFormat: NaN,
		parity: NaN,
		unheard: NaN,
		decoded: NaN,
		accepted: NaN,
		repaired: NaN,
		clipped: NaN,
		blocks: NaN,
		levelSum: NaN
	};
	let rates = $derived(measured ?? UNMEASURED);

	let preamble = $derived(rates.candidates - rates.noPreamble);
	let format = $derived(preamble - rates.unknownFormat);
	let passed = $derived(rates.accepted + rates.repaired);

	/** Bar width on a log scale from 1/s to the sample rate. */
	const width = (n: number) =>
		Number.isNaN(n)
			? '0%'
			: `${(Math.max(0, Math.log10(Math.max(n, 1))) / Math.log10(Math.max(rates.samples, 10))) * 100}%`;
	const share = (part: number, whole: number) => (whole > 0 ? percent(part / whole) : '–');
	const rate = (x: number) => (Number.isNaN(x) ? '–' : perSecond(x));
</script>

{#snippet bar(n: number, color: string)}
	<div class="h-2 w-full rounded-sm bg-zinc-800">
		<div class={['h-2 rounded-sm', color]} style:width={width(n)}></div>
	</div>
{/snippet}

<section class="rounded-lg border border-zinc-800 p-4">
	<div class="mb-3 flex">
		<InfoTip
			heading="h2"
			class="text-sm font-semibold text-zinc-100"
			label="From samples to messages"
			wide
		>
			<p>
				How the demodulator finds messages among the samples, step by step, and how many get through
				each step per second (over the last 10 s). Almost all of what the dongle hears is noise, so
				the cheap tests come first and throw most of it away. Only the parity, at the end, can tell
				a message from noise that happens to look like one.
			</p>
			<p class="text-zinc-400">
				The bars are on a logarithmic scale: every factor of ten fewer takes the same length off a
				bar.
			</p>
		</InfoTip>
	</div>

	<table class="w-full table-fixed text-sm tabular-nums">
		<thead class="text-left text-xs text-zinc-500">
			<tr>
				<th class="w-28 py-1 font-normal">Step</th>
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
							2.4 million a second, one every 0.42 µs, each saying how strong the signal is at that
							moment (the length of its I/Q pair). A message is made of pulses half a µs long, so a
							pulse spans just 1.2 samples.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{rate(rates.samples)}</td>
				<td></td>
				<td class="py-1 pl-4">{@render bar(rates.samples, 'bg-zinc-500')}</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Quick test">
						<p>
							Every message starts with a <strong>preamble</strong>: four pulses in a fixed pattern,
							8 µs in all. This test takes four samples that fall inside those pulses and nine that
							fall in the gaps between them: each of the four must be 1.5 times as strong as the
							gaps on average, and as the noise. It uses whole samples only, so it's cheap.
						</p>
						<p>
							What fails gets a second chance with the test of readsb (a widely used decoder), which
							compares the pulses with the samples right beside them and so lets in weaker messages.
						</p>
						<p class="text-zinc-400">The samples next to a real preamble often pass too.</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{rate(rates.candidates)}</td>
				<td class="py-1 text-right text-zinc-400">{share(rates.candidates, rates.samples)}</td>
				<td class="py-1 pl-4">{@render bar(rates.candidates, 'bg-blue-700')}</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Preamble">
						<p>
							A message can start anywhere between two samples, so each sample that passed is tried
							as five starts, 0.2 samples (1/12 µs) apart. A start counts if its four pulses are 1.8
							times as strong as the gaps between them (5.1 dB).
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{rate(preamble)}</td>
				<td class="py-1 text-right text-zinc-400">{share(preamble, rates.candidates)}</td>
				<td class="py-1 pl-4">
					{@render bar(preamble, 'bg-blue-600')}
					<div class="mt-0.5 text-xs text-zinc-500">
						{rate(rates.noPreamble)}/s no start looked like a preamble
					</div>
				</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Format">
						<p>
							Now the bits are read: each bit is a pulse in its first half (1) or its second half
							(0). First all at once, as the string of bits whose pulses best match the samples,
							drawn the way the dongle shows them: rounded, and spilling into the next half bit. If
							that fails the parity, bit by bit: with readsb's method, which weighs three or four
							samples per bit, then by comparing each bit's first half with its second.
						</p>
						<p>
							The first 5 bits are the <strong>downlink format</strong> (DF), the kind of message, which
							also says how long it is: 56 or 112 bits. Only 11 formats are defined; any other value means
							noise.
						</p>
						<p class="text-zinc-400">
							What only readsb's test let in is read with its method alone: it's mostly noise, and a
							lot of it.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{rate(format)}</td>
				<td class="py-1 text-right text-zinc-400">{share(format, preamble)}</td>
				<td class="py-1 pl-4">
					{@render bar(format, 'bg-blue-500')}
					<div class="mt-0.5 text-xs text-zinc-500">
						{rate(rates.unknownFormat)}/s a format that doesn't exist
					</div>
				</td>
			</tr>
			<tr class="border-t border-zinc-800">
				<td class="py-1">
					<InfoTip label="Parity" wide>
						<p>
							The last 24 bits are a check code worked out from the rest of the message. In ADS-B
							messages and DF11 squitters (an aircraft announcing its address unasked), redoing the
							sum must give 0. A single wrong bit can then be found and flipped back, but only for
							an aircraft heard intact within the last {KNOWN_FOR_S} s: otherwise noise would pass as
							a repaired message several times an hour.
						</p>
						<p>
							Replies to a radar mix something into the check code: most the aircraft's address, so
							any string of bits "passes" for some address; a DF11 reply the radar's own code (or 0,
							like a squitter). These only count from an aircraft heard intact within the last {KNOWN_FOR_S}
							s. That's where most noise ends:
							<em>address not heard</em>.
						</p>
					</InfoTip>
				</td>
				<td class="py-1 text-right">{rate(passed)}</td>
				<td class="py-1 text-right text-zinc-400">{share(passed, format)}</td>
				<td class="py-1 pl-4">
					{@render bar(passed, 'bg-green-500')}
					<div class="mt-0.5 text-xs text-zinc-500">
						<div>{rate(rates.parity)}/s parity wrong</div>
						<div>{rate(rates.unheard)}/s address not heard</div>
						<div>{rate(rates.repaired)}/s passed after a repair</div>
					</div>
				</td>
			</tr>
		</tbody>
	</table>
</section>
