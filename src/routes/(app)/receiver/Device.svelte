<!--
	The dongle and the link to it: what rtl_sdr or rtl_tcp told us about the hardware, the
	settings lab1090 uses, and the history of the link (starts, failures and why). With a
	Beast feed only the source (its tooltip says why) and the link.
-->
<script lang="ts">
	import { bytesText, dayAndTime, minutesSeconds } from '#lib/describe/format.ts';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { DemodReport, RecordingReport, SourceEvent } from '#lib/receiver-types.ts';

	interface Props {
		/** "RTL-SDR 0", "pi:1234 (rtl_tcp)"… */
		source: string | null;
		/** null: a Beast feed. */
		demod: DemodReport | null;
		events: SourceEvent[];
		/** The samples' recording (--record); null: none. */
		recording: RecordingReport | null;
	}

	let { source, demod, events, recording }: Props = $props();

	/** "4:12 of 5:00, 160 MB", "saved, 5:00, 470 MB". */
	let recorded = $derived.by(() => {
		if (!recording) return null;
		const length = `${minutesSeconds(recording.ms)} of ${minutesSeconds(recording.plannedMs)}`;
		const size = bytesText(recording.bytes);
		switch (recording.state) {
			case 'waiting':
				return 'waiting for the first samples';
			case 'recording':
			case 'finishing':
				return `${length}, ${size}`;
			case 'saved':
				return `saved, ${minutesSeconds(recording.ms)}, ${size}`;
			case 'failed':
				return 'failed';
		}
	});

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
		{#if demod || !source}
			<dt class="text-zinc-400">Source</dt>
		{:else}
			<dt>
				<InfoTip label="Source">
					<p>
						A Beast feed: messages already demodulated on that machine, by readsb, dump1090 or
						another lab1090, each sent with its time and signal level. The samples, gain, noise and
						CPU show in that receiver's own statistics; here are only the link and the signal
						levels.
					</p>
				</InfoTip>
			</dt>
		{/if}
		<dd>{source ?? '–'}</dd>
		{#if demod}
			<dt>
				<InfoTip label="Tuner">
					<p>
						The chip that picks 1090 MHz out of everything the antenna hears and shifts it down to a
						low frequency, for the dongle's other chip, the RTL2832U, to sample. Each tuner has its
						own set of gain steps. The R820T and R828D are the usual ones; rtl_tcp reports which
						type, rtl_sdr the chip's name.
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
						Every Mode S reply and ADS-B message is sent on 1090 MHz. Taking 2.4 million samples a
						second covers the 2.4 MHz around it, 1088.8–1091.2 MHz; most of a message's power lies
						within about 1 MHz either side of its frequency.
					</p>
				</InfoTip>
			</dt>
			<dd>1090 MHz · 2.4 million samples/s</dd>
			<dt class="text-zinc-400">Runs</dt>
			<dd>{demod.runs}</dd>
		{/if}
		{#if recording}
			<dt class="text-zinc-400">Recording</dt>
			<dd class="min-w-0">
				<span class="block truncate font-mono">{recording.file}</span>
				<span class={recording.state === 'failed' || recording.stopped ? 'text-warn-300' : ''}>
					{recorded}{recording.stopped ? `: ${recording.stopped}` : ''}
				</span>
			</dd>
		{/if}
	</dl>

	{#if shown.length}
		<h3 class="mt-4 mb-1 text-xs text-zinc-500">History of the link</h3>
		<table class="w-full table-fixed text-sm tabular-nums">
			<tbody>
				{#each shown as e (e.id)}
					<tr class="border-t border-zinc-800 align-baseline">
						<td class="w-36 py-0.5 text-zinc-400">{dayAndTime(e.t)}</td>
						<td class={['w-32 py-0.5', e.state === 'waiting' ? 'text-warn-300' : '']}
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
