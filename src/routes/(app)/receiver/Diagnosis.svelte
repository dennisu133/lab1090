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

<section class="rounded-lg bg-zinc-900 p-4">
	<h2 class="mb-3 text-sm font-semibold tracking-wide text-zinc-400 uppercase">Diagnosis</h2>
	<dl class="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm tabular-nums">
		<dt>
			<InfoTip label="Gain" wide>
				<p>
					The dongle's ADC has 8 bits for I and for Q: 256 levels, about 48 dB from one step to full
					scale. The gain decides where the sky lands in that range. Too little, and the noise is
					smaller than one step: rounding to whole steps adds noise of its own and the weakest
					messages go. Too much, and strong messages hit the top and get cut off, while the tuner
					itself starts mixing signals into each other.
				</p>
				<p>
					So: too high when more than {percent(MAX_CLIPPED)} of messages clip, too low when rounding costs
					more than {MAX_ROUNDING_DB} dB (see Noise). A suggestion is a step of this tuner about 3 dB
					away. Set with <code>--gain</code> or <code>gain</code> in the config file; it takes effect
					on the next start.
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
					The mean magnitude of all samples, which is almost all noise: the receiver's own (the
					tuner and the first amplifier) plus whatever the antenna picks up. In dBFS, decibels below
					full scale.
				</p>
				<p>
					From it follows σ, the noise's spread on I and Q in ADC steps (a table from simulated
					Gaussian noise), and what rounding to whole steps costs: it adds 1/12 step² of noise, so
					10·log₁₀(1 + 1/(12σ²)) dB of signal-to-noise. 0.35 dB at σ = 1, 1 dB at σ = 0.57.
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
					Messages with a sample at the ADC's limit: I or Q at its last code, so at some phase of
					the carrier the wave was cut off. One now and then is an aircraft passing close by; many
					mean the gain is too high.
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
					The dongle makes 2.4 million samples a second from its own crystal, so the samples are a
					clock too. Held against the server's clock, the difference (the lag) jumps when samples go
					missing: a lost buffer is 131,072 samples, 55 ms. That happens when they aren't read in
					time: USB trouble, rtl_tcp's network link, or lab1090 too slow.
				</p>
				<p>
					The samples arrive in chunks a few ms late, so the smallest lag in each 10 s counts. A
					rise that goes away again was a stall (everything late, nothing lost).
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
					Time spent finding and reading messages, per second of samples, on one CPU core. Near 100
					% the samples pile up faster than they're read, and then get lost.
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
					How far the dongle's 28.8 MHz crystal is off, in parts per million: the slow slope of the
					same lag (+1 ppm: 1 ms more samples per 1000 s). Cheap dongles are often 20–50 ppm off,
					those with a temperature-compensated crystal (TCXO) about 1.
				</p>
				<p>
					Mode S doesn't mind: 50 ppm tunes 55 kHz beside 1090 MHz, well inside the 2.4 MHz we
					sample, and the demodulator only looks at the magnitude, not the phase. It would matter
					for timing between receivers (multilateration). The ± is the fit's standard error; it
					shrinks the longer a run goes.
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
