<!--
	The receiver at a glance: the gain, the noise, clipped messages, lost samples, the time
	demodulating takes and the dongle's crystal, each with a verdict. Judged on the last 5
	minutes of the server's history (DIAGNOSIS_MS), except the sample clock (this run).
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { MAX_CLIPPED, MAX_ROUNDING_DB, MIN_MESSAGES, type GainAdvice } from '#lib/radio/gain.ts';
	import type { Summary } from '#lib/radio/history.ts';
	import type { DemodReport } from '#lib/receiver-types.ts';
	import { dbfs, n, signed } from '#lib/describe/format.ts';
	import { duration, percent, TONE_DOT, type Tone } from './format';

	interface Props {
		demod: DemodReport;
		/** The last 5 minutes. */
		summary: Summary;
		advice: GainAdvice;
	}

	let { demod, summary, advice }: Props = $props();

	/** CPU: past these shares of real time, the samples are at risk of piling up. */
	const BUSY_WARN = 0.5;
	const BUSY_BAD = 0.9;
	/** The crystal is shown once its standard error is this small, ppm. */
	const PPM_SHOWN = 2;

	let gain = $derived(demod.device.gain);
	/** A recording's gain is whatever it was recorded with: unknown here. */
	let gainText = $derived(gain === null ? '' : `${gain} dB: `);

	let gainRow = $derived.by((): { tone: Tone; text: string } => {
		switch (advice.verdict) {
			case 'fine':
				return { tone: 'good', text: 'fine' };
			case 'unknown':
				if (advice.roundingDb === null) return { tone: 'none', text: 'not measured yet' };
				return {
					tone: 'none',
					text: `the noise is fine; clipping needs traffic (${MIN_MESSAGES} messages in 5 min)`
				};
			case 'high':
				return {
					tone: 'bad',
					text:
						advice.suggest === null
							? 'too high, and there is no lower step to suggest'
							: `too high: try --gain ${advice.suggest}`
				};
			case 'low':
				return {
					tone: 'warn',
					text: advice.atTop
						? 'low, but at the highest step already: an LNA (preamplifier) at the antenna would help'
						: advice.suggest === null
							? 'too low'
							: `too low: try --gain ${advice.suggest}`
				};
		}
	});

	let busy = $derived(summary.busyShare);
	let clock = $derived(demod.clock);
</script>

<section class="rounded-lg border border-zinc-800 p-4">
	<h2 class="mb-3 text-sm font-semibold text-zinc-100">Diagnosis</h2>
	<dl class="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm tabular-nums">
		<dt>
			<InfoTip label="Gain" wide>
				<p>
					The dongle turns the radio wave into numbers with an <strong>ADC</strong>
					(analogue-to-digital converter). Each sample is a pair of numbers, I and Q, that together describe
					the wave at that moment, and each has only 8 bits: 256 levels, 128 either side of the middle.
					So one step is 42 dB below the strongest wave the ADC can hold. The <strong>gain</strong>,
					how much the tuner amplifies before that, decides where in this range the signals land.
				</p>
				<p>
					Too little, and the background noise is smaller than one step: rounding to whole steps
					adds noise of its own, and the weakest messages are lost. Too much, and strong messages
					hit the top and are cut off, while the tuner starts mixing signals into each other.
				</p>
				<p class="text-zinc-400">
					Too high when more than {percent(MAX_CLIPPED)} of messages are clipped, too low when rounding
					costs more than {MAX_ROUNDING_DB} dB (see Noise) and hardly any message clips. A suggested value
					is one of this tuner's steps, about 3 dB away. Set it with <code>--gain</code> or
					<code>gain</code> in the config file; it takes effect on the next start.
				</p>
			</InfoTip>
		</dt>
		<dd class="flex items-baseline gap-2">
			<span class={['size-2 shrink-0 self-center rounded-full', TONE_DOT[gainRow.tone]]}></span>
			<span>{gainText}{gainRow.text}</span>
		</dd>

		<dt>
			<InfoTip label="Noise" wide>
				<p>
					The average strength of all the samples, in <strong>dBFS</strong>: decibels below the
					strongest signal the ADC can hold (0 dBFS). Messages fill only a sliver of the time, so
					this is almost all noise: the receiver's own (the tuner and its first amplifier) plus
					whatever the antenna picks up.
				</p>
				<p>
					From it follows <math><mi>σ</mi></math>, how far the noise typically swings on I and Q, in
					ADC steps (looked up in a table made with simulated noise). Rounding to a whole step is
					off by up to half a step either way, which adds noise of
					<math><mfrac displaystyle="true"><mn>1</mn><mn>12</mn></mfrac></math> step² to the noise's
					own <math><msup><mi>σ</mi><mn>2</mn></msup></math>.
				</p>
				<p>
					So the messages stand out above the noise by
					<math>
						<mn>10</mn><mo>·</mo><msub><mi>log</mi><mn>10</mn></msub><mo>(</mo><mn>1</mn><mo>+</mo>
						<mfrac displaystyle="true">
							<mn>1</mn>
							<mrow><mn>12</mn><msup><mi>σ</mi><mn>2</mn></msup></mrow>
						</mfrac>
						<mo>)</mo>
					</math>
					dB less: 0.35 dB at <math><mi>σ</mi><mo>=</mo><mn>1</mn></math>, 1 dB at
					<math><mi>σ</mi><mo>=</mo><mn>0.57</mn></math>.
				</p>
			</InfoTip>
		</dt>
		<dd class="flex items-baseline gap-2">
			{#if summary.noise !== null && advice.sigma !== null && advice.roundingDb !== null}
				<span
					class={[
						'size-2 shrink-0 self-center rounded-full',
						TONE_DOT[advice.roundingDb > MAX_ROUNDING_DB ? 'warn' : 'good']
					]}
				></span>
				<span>
					{dbfs(summary.noise)}: σ ≈ {advice.sigma.toFixed(2)} ADC steps, rounding costs
					{advice.roundingDb.toFixed(1)} dB
				</span>
			{:else}
				<span class={['size-2 shrink-0 self-center rounded-full', TONE_DOT.none]}></span>
				<span class="text-zinc-500">not measured yet</span>
			{/if}
		</dd>

		<dt>
			<InfoTip label="Clipped">
				<p>
					Messages during which a sample reached the ADC's limit: the wave, from the message itself
					or from a closer aircraft sending at the same moment, was as strong as the 8 bits can
					hold, so its peaks were cut off. An aircraft passing close by does that for a minute or
					two; many clipped messages all the time mean the gain is too high.
				</p>
			</InfoTip>
		</dt>
		<dd class="flex items-baseline gap-2">
			{#if advice.clippedShare !== null}
				<span
					class={[
						'size-2 shrink-0 self-center rounded-full',
						TONE_DOT[advice.clippedShare > MAX_CLIPPED ? 'bad' : 'good']
					]}
				></span>
				<span>
					{percent(advice.clippedShare)}
					<span class="text-zinc-500">
						({n(summary.clipped ?? 0)} of {n(summary.demodulated ?? 0)} messages)</span
					>
				</span>
			{:else}
				<span class={['size-2 shrink-0 self-center rounded-full', TONE_DOT.none]}></span>
				<span class="text-zinc-500">
					{n(summary.demodulated ?? 0)} messages in 5 min: too few to say
				</span>
			{/if}
		</dd>

		<dt>
			<InfoTip label="Samples lost" wide>
				<p>
					The dongle takes 2.4 million samples a second, timed by its own crystal, so counting the
					samples gives a clock of its own. Against the server's clock, the difference (the
					<strong>lag</strong>) jumps when samples go missing: a lost buffer is 131,072 samples, 55
					ms. Samples are lost when nobody collects them in time: USB trouble, a slow network to
					rtl_tcp, or lab1090 itself falling behind.
				</p>
				<p class="text-zinc-400">
					Samples arrive in batches a few ms late, so each 10 s counts with its smallest lag. A rise
					that goes away again was a stall: everything arrived late, but nothing was lost.
				</p>
			</InfoTip>
		</dt>
		<dd class="flex items-baseline gap-2">
			{#if clock}
				<span
					class={[
						'size-2 shrink-0 self-center rounded-full',
						TONE_DOT[demod.gaps ? 'bad' : 'good']
					]}
				></span>
				<span>
					{#if demod.gaps === 0}
						none
					{:else}
						{demod.gaps}× since the start, {Math.round(demod.lostMs)} ms in all ({n(
							demod.lostMs * 2400
						)} samples)
					{/if}
				</span>
			{:else}
				<span class={['size-2 shrink-0 self-center rounded-full', TONE_DOT.none]}></span>
				<span class="text-zinc-500">a recording: played at our own pace, nothing to measure</span>
			{/if}
		</dd>

		<dt>
			<InfoTip label="Demodulating">
				<p>
					How long finding and reading messages takes, against the time the samples cover, on one
					CPU core: at 5 %, each second of samples takes 50 ms. Near 100 % the samples arrive faster
					than they're read, pile up and are lost.
				</p>
			</InfoTip>
		</dt>
		<dd class="flex items-baseline gap-2">
			{#if busy !== null}
				<span
					class={[
						'size-2 shrink-0 self-center rounded-full',
						TONE_DOT[busy > BUSY_BAD ? 'bad' : busy > BUSY_WARN ? 'warn' : 'good']
					]}
				></span>
				<span>{percent(busy)} of one core</span>
			{:else}
				<span class={['size-2 shrink-0 self-center rounded-full', TONE_DOT.none]}></span>
				<span class="text-zinc-500">not measured yet</span>
			{/if}
		</dd>

		<dt>
			<InfoTip label="Crystal" wide>
				<p>
					A quartz crystal sets the dongle's pace: the frequency it tunes to and how fast it
					samples. This is how far its 28.8 MHz crystal is off, in millionths (ppm), measured from
					how the lag (see Samples lost) slowly drifts: at +1 ppm, every 1000 s brings 1 ms of
					samples too many. Cheap dongles are often tens of ppm off, and more while they warm up;
					those with a temperature-compensated crystal (TCXO) about 1.
				</p>
				<p class="text-zinc-400">
					Receiving Mode S doesn't mind: 50 ppm off tunes 55 kHz beside 1090 MHz, while transponders
					themselves may be up to 1 MHz off, and the demodulator only looks at how strong the signal
					is, not at its phase. Multilateration, which times one message at several receivers, works
					out a steady error like this by itself.
				</p>
				<p class="text-zinc-400">
					The ± is how precise the measurement is so far; it shrinks the longer lab1090 runs. But
					the crystal drifts with its temperature, for a while after a start and between night and
					day, and the ± doesn't show that: it assumes the error stays put.
				</p>
			</InfoTip>
		</dt>
		<dd class="flex items-baseline gap-2">
			<span class={['size-2 shrink-0 self-center rounded-full', TONE_DOT.none]}></span>
			{#if !clock}
				<span class="text-zinc-500">a recording</span>
			{:else if clock.ppm !== null && clock.ppmError !== null && clock.ppmError <= PPM_SHOWN}
				<span>{signed(clock.ppm)} ± {clock.ppmError.toFixed(1)} ppm</span>
			{:else}
				<span class="text-zinc-500">measuring ({duration(clock.seconds)} so far)</span>
			{/if}
		</dd>
	</dl>
</section>
