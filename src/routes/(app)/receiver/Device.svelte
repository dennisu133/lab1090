<!--
	The dongle and the link to it: what rtl_sdr or rtl_tcp told us about the hardware, the
	settings lab1090 uses, and the history of the link (starts, failures and why).
-->
<script lang="ts">
	import { dayAndTime } from '#lib/describe/format.ts';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { DemodReport, SourceEvent } from '#lib/receiver-types.ts';

	interface Props {
		/** "RTL-SDR 0", "pi:1234 (rtl_tcp)"… */
		source: string | null;
		/** null: a Beast feed. */
		demod: DemodReport | null;
		events: SourceEvent[];
	}

	let { source, demod, events }: Props = $props();

	const STATES: Record<SourceEvent['state'], string> = {
		connected: 'receiving',
		waiting: 'stopped',
		ended: 'recording ended'
	};

	/** Newest first, at most this many. */
	const EVENTS_SHOWN = 8;
	let shown = $derived(events.toReversed().slice(0, EVENTS_SHOWN));
</script>

<section class="rounded-lg border border-zinc-800 p-4">
	<h2 class="mb-3 text-sm font-semibold text-zinc-100">Device</h2>
	<dl class="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
		<dt class="text-zinc-400">Source</dt>
		<dd>{source ?? '–'}</dd>
		{#if demod}
			<dt>
				<InfoTip label="Tuner">
					<p>
						The chip that picks 1090 MHz out of everything the antenna hears and mixes it down to 0
						Hz for the RTL2832U, which samples it. Each tuner has its own gain steps. The R820T and
						R828D are the usual ones; rtl_tcp tells their type, rtl_sdr its name.
					</p>
				</InfoTip>
			</dt>
			<dd>{demod.device.tuner ?? 'not reported'}</dd>
			{#if demod.device.name}
				<dt class="text-zinc-400">USB device</dt>
				<dd>
					{demod.device.name}
					{#if demod.device.serial}<span class="text-zinc-500">
							· serial {demod.device.serial}</span
						>{/if}
				</dd>
			{/if}
			<dt class="text-zinc-400">Gain</dt>
			<dd>{demod.device.gain === null ? 'as recorded' : `${demod.device.gain} dB`}</dd>
			<dt>
				<InfoTip label="Tuned to">
					<p>
						1090 MHz, where every Mode S reply and ADS-B message is sent, sampled 2.4 million times
						a second: the samples cover 1088.8–1091.2 MHz. A message's pulses take about 2 MHz of
						that.
					</p>
				</InfoTip>
			</dt>
			<dd>1090 MHz · 2.4 million samples/s</dd>
			<dt class="text-zinc-400">Runs</dt>
			<dd>{demod.runs}</dd>
		{/if}
	</dl>

	{#if shown.length}
		<h3 class="mt-4 mb-1 text-xs text-zinc-500">History of the link</h3>
		<table class="w-full table-fixed text-sm tabular-nums">
			<tbody>
				{#each shown as e (e.id)}
					<tr class="border-t border-zinc-800 align-baseline">
						<td class="w-36 py-0.5 text-zinc-400">{dayAndTime(e.t)}</td>
						<td class={['w-32 py-0.5', e.state === 'waiting' ? 'text-amber-300' : '']}
							>{STATES[e.state]}</td
						>
						<td class="py-0.5 text-zinc-400">
							{e.reason ?? ''}
							{#if e.count > 1}
								<span class="text-zinc-500">({e.count}× until {dayAndTime(e.last)})</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
