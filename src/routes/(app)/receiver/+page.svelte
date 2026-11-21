<!--
	/receiver: the receiver itself rather than the aircraft. On top the diagnosis (is the gain
	right, are samples lost, can the CPU keep up), then the dongle and its link, the
	demodulator's steps, the last hour (from the server, so a reload keeps it) and signal
	against distance. With a Beast feed the demodulator is somewhere else: only the message
	rate and the signal levels are here.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { dbfs, n } from '#lib/describe/format.ts';
	import { adviseGain, MAX_ROUNDING_DB, ROUNDING_LIMIT_DBFS } from '#lib/radio/gain.ts';
	import { DIAGNOSIS_MS, summarize } from '#lib/radio/history.ts';
	import { freeSpaceLevel } from '#lib/radio/path-loss.ts';
	import { receiverLink } from '#lib/receiver-link.svelte.ts';
	import PageTitle from '../PageTitle.svelte';
	import { getStreams } from '../streams';
	import Device from './Device.svelte';
	import Diagnosis from './Diagnosis.svelte';
	import HistoryChart from './HistoryChart.svelte';
	import SignalChart from './SignalChart.svelte';
	import Stages from './Stages.svelte';
	import { perSecond } from './format';

	const { radio, signal, stats } = getStreams();

	let demod = $derived(radio.demod);
	let points = $derived(radio.points);
	let end = $derived(points.at(-1)?.t ?? Date.now());
	let summary = $derived(summarize(points, end - DIAGNOSIS_MS));
	let advice = $derived(
		demod
			? adviseGain({
					tuner: demod.device.tuner,
					gain: demod.device.gain,
					noise: summary.noise,
					messages: summary.demodulated ?? 0,
					clipped: summary.clipped ?? 0
				})
			: null
	);

	let noiseSeries = $derived(points.map((p) => ({ t: p.t, value: p.noise })));
	let noiseRange = $derived.by(() => {
		const values = points.flatMap((p) => (p.noise === null ? [] : [p.noise]));
		const low = Math.min(ROUNDING_LIMIT_DBFS, ...values);
		const high = Math.max(ROUNDING_LIMIT_DBFS, ...values);
		const min = Math.floor((low - 2) / 2) * 2;
		const max = Math.max(min + 8, Math.ceil((high + 2) / 2) * 2);
		const step = max - min > 16 ? 6 : 2;
		const ticks = [];
		for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
		return { min, max, ticks };
	});

	let rateSeries = $derived(points.map((p) => ({ t: p.t, value: p.messages / (p.ms / 1000) })));
	let rateRange = $derived.by(() => {
		const high = Math.max(10, ...rateSeries.map((p) => p.value));
		const step = high > 400 ? 200 : high > 200 ? 100 : high > 80 ? 50 : high > 40 ? 20 : 10;
		const max = Math.ceil(high / step) * step;
		const ticks = [];
		for (let v = 0; v <= max; v += step) ticks.push(v);
		return { max, ticks };
	});

	let level = $derived(freeSpaceLevel(signal.points));
	let aircraftCount = $derived(new Set(signal.points.map((p) => p.icao)).size);
	/** Where the free-space line meets the noise, km. */
	let crossing = $derived(
		level !== null && summary.noise !== null ? 10 ** ((level - summary.noise) / 20) : null
	);
</script>

{#snippet messages()}
	<section class="rounded-lg border border-zinc-800 p-4">
		<div class="mb-2 flex items-baseline gap-3">
			<InfoTip heading="h2" class="text-sm font-semibold text-zinc-100" label="Messages">
				<p>
					Messages per second, of every kind, averaged over 10 s. It follows the traffic: quiet at
					night, busy in the afternoon. A dip the traffic doesn't explain is the receiver having
					trouble.
				</p>
			</InfoTip>
			<span class="text-sm text-zinc-400">{perSecond(stats.rates.total)}/s now</span>
		</div>
		<HistoryChart
			series={rateSeries}
			{end}
			min={0}
			max={rateRange.max}
			ticks={rateRange.ticks}
			format={(v) => `${v}`}
			color="stroke-green-400"
			label="Messages per second over the last hour"
		/>
	</section>
{/snippet}

<PageTitle page="Receiver" />

<div class="space-y-6">
	{#if demod && advice}
		<Diagnosis {demod} {summary} {advice} />
	{:else if receiverLink.source}
		<section class="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-300">
			<h2 class="mb-2 text-sm font-semibold text-zinc-100">Diagnosis</h2>
			<p>
				Messages come from a Beast feed ({receiverLink.source}): already demodulated on that
				machine, by readsb, dump1090 or another lab1090. Its samples, gain, noise and CPU show in
				its own statistics; here are only the message rate and the signal levels.
			</p>
		</section>
	{/if}

	<div class="grid gap-6 xl:grid-cols-2">
		{#if demod && radio.rates}
			<Stages rates={radio.rates} />
		{/if}
		<Device source={receiverLink.source} {demod} events={radio.events} />
		<!-- A Beast feed: no stages and no noise, so the messages go next to the device. -->
		{#if !demod}
			{@render messages()}
		{/if}
	</div>

	{#if demod}
		<div class="grid gap-6 xl:grid-cols-2">
			<section class="rounded-lg border border-zinc-800 p-4">
				<div class="mb-2 flex items-baseline gap-3">
					<InfoTip heading="h2" class="text-sm font-semibold text-zinc-100" label="Noise level">
						<p>
							The noise (see Noise in the diagnosis) for every 10 s of the last hour. It rises with
							the gain and with interference: other transmitters, or electronics nearby such as USB
							3 devices and computers. Below the dashed line, rounding to the ADC's steps costs more
							than {MAX_ROUNDING_DB} dB.
						</p>
					</InfoTip>
					{#if summary.noise !== null}
						<span class="text-sm text-zinc-400">{dbfs(summary.noise)} over 5 min</span>
					{/if}
				</div>
				<HistoryChart
					series={noiseSeries}
					{end}
					min={noiseRange.min}
					max={noiseRange.max}
					ticks={noiseRange.ticks}
					format={n}
					reference={{ value: ROUNDING_LIMIT_DBFS, label: 'rounding > 1 dB below' }}
					color="stroke-blue-400"
					label="Noise level over the last hour, dBFS"
				/>
			</section>
			{@render messages()}
		</div>
	{/if}

	<section class="rounded-lg border border-zinc-800 p-4">
		<div class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<InfoTip
				heading="h2"
				class="text-sm font-semibold text-zinc-100"
				label="Signal against distance"
				wide
			>
				<p>
					Each dot is an aircraft's signal strength at its distance, one per aircraft every 10 s,
					over the last hour (collected by this tab: a reload starts over). With nothing in the way,
					a signal's power falls with the square of the distance: ten times as far is a hundred
					times weaker, 20 dB. That's the dashed <strong>free space</strong> line, fitted through the
					middle of the dots (their median).
				</p>
				<p>
					The dots scatter around it because transponders differ (at least 70 W for light aircraft,
					125 W for faster or higher ones, at most 500 W), and so do their antennas. A vertical
					antenna hears little straight up, so nearby aircraft high above (amber) tend to sit below
					the line, and so do aircraft behind a building or a hill.
				</p>
				<p>
					Messages are rarely read less than about 10 dB above the noise. So aircraft on the line
					are lost at about a third of the distance where it meets the noise, even with a clear
					view.
				</p>
				<p class="text-zinc-400">
					The bars on the right count every message since the server started, by signal strength, on
					the same scale.
				</p>
			</InfoTip>
			<span class="text-sm text-zinc-400">
				{n(signal.points.length)} points from {aircraftCount} aircraft
				{#if crossing !== null}
					· free space reaches the noise at ~{n(crossing)} km
				{/if}
			</span>
		</div>
		<SignalChart
			points={signal.points}
			{level}
			noise={summary.noise}
			histogram={stats.counts?.bySignal ?? {}}
		/>
	</section>
</div>
