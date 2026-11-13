<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { DF_NAMES, containmentRadius, typeCodeName } from '#lib/modes/frame.ts';
	import CountTable from './CountTable.svelte';
	import HexFrame, { PART_COLORS } from './HexFrame.svelte';
	import SignalHistogram from './SignalHistogram.svelte';
	import { RawStream } from './raw-stream.svelte';

	const FEED_ROWS = 200;

	const stream = new RawStream();
	$effect(() => stream.connect());

	let dfFilter = $state<number | null>(null);

	let update = $derived(stream.update);
	let status = $derived(update?.status);

	let dfRows = $derived(
		Object.entries(update?.counts.byDf ?? {}).map(([k, count]) => ({
			key: +k,
			label: DF_NAMES[+k] ?? 'Unknown',
			count,
			rate: stream.rates.byDf[+k] ?? 0
		}))
	);
	let tcRows = $derived(
		Object.entries(update?.counts.byTc ?? {}).map(([k, count]) => ({
			key: +k,
			label: typeCodeName(+k),
			detail: containmentRadius(+k) === null ? undefined : `Rc ${containmentRadius(+k)}`,
			count,
			rate: stream.rates.byTc[+k] ?? 0
		}))
	);

	let feed = $derived(
		(dfFilter === null ? stream.frames : stream.frames.filter((f) => f.df === dfFilter)).slice(
			0,
			FEED_ROWS
		)
	);

	const time = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3,
		hour12: false
	});
	const clock = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});

	function signalTitle(dbfs: number) {
		const amplitude = 10 ** (dbfs / 20) * 100;
		const power = 10 ** (dbfs / 10) * 100;
		return `${dbfs.toFixed(1)} dBFS: amplitude ${amplitude.toFixed(1)} %, power ${power.toFixed(2)} % of full scale`;
	}

	function toggleFilter(df: number) {
		dfFilter = dfFilter === df ? null : df;
	}
</script>

<svelte:head>
	<title>Raw frames · ADS-B</title>
</svelte:head>

<div class="space-y-6">
	<!-- Status bar -->
	<header
		class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm"
	>
		<div class="flex items-center gap-2">
			{#if !stream.online}
				<span class="size-2.5 rounded-full bg-zinc-500"></span>
				<span>Server stream offline, retrying…</span>
			{:else if status?.state === 'connected'}
				<span class="size-2.5 animate-pulse rounded-full bg-emerald-400"></span>
				<span>Receiving from <code class="text-zinc-300">{update?.source}</code></span>
			{:else if status?.state === 'waiting'}
				<span class="size-2.5 rounded-full bg-amber-400"></span>
				<span>
					Receiver unreachable ({status.reason}), retrying in {(status.retryInMs / 1000).toFixed(0)} s
				</span>
			{:else}
				<span class="size-2.5 rounded-full bg-amber-400"></span>
				<span>Connecting to <code>{update?.source ?? 'receiver'}</code>…</span>
			{/if}
		</div>
		<div class="tabular-nums">
			<span class="text-2xl font-semibold">{stream.rates.total.toFixed(1)}</span>
			<span class="text-zinc-400">msg/s</span>
		</div>
		{#if update}
			<div class="text-zinc-400 tabular-nums">
				<span class="text-zinc-100">{update.counts.total.toLocaleString()}</span> messages since
				{clock.format(update.since)}
			</div>
		{/if}
	</header>

	<!-- Counts -->
	<div class="grid gap-6 lg:grid-cols-2">
		<CountTable
			title="Downlink formats"
			keyLabel="DF"
			rows={dfRows}
			selected={dfFilter}
			onselect={toggleFilter}
		/>
		<CountTable title="ADS-B type codes (DF17)" keyLabel="TC" rows={tcRows}>
			{#snippet info()}
				<p>
					The type code is the first 5 bits of an ADS-B message's payload and says what it carries.
				</p>
				<p>
					All airborne positions (TC 9–18 with barometric altitude, 20–22 with GNSS height) have the
					same layout. The type code additionally says how much the aircraft vouches for the
					position: the <strong>containment radius Rc</strong>. The avionics guarantee, with about a
					1 in 10 million risk of being wrong, that the true position is inside that circle.
				</p>
				<p>
					That's <em>integrity</em>, not accuracy: a TC 11 aircraft is usually within a few metres.
					Its GPS just won't vouch for more than 185 m. An aircraft keeps its type code, since it
					depends on its navigation equipment.
				</p>
				<p class="text-zinc-400">
					"or": a bit in the aircraft's operational status message (TC 31) decides.
				</p>
			{/snippet}
		</CountTable>
	</div>

	<SignalHistogram counts={update?.counts.bySignal ?? {}} />

	<!-- Feed -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<h2 class="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Live frames</h2>
			<button
				class="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
				onclick={() => stream.togglePause()}
			>
				{stream.paused ? `Resume (${stream.held} new)` : 'Pause'}
			</button>
			{#if dfFilter !== null}
				<button
					class="rounded bg-sky-900 px-3 py-1 text-sm hover:bg-sky-800"
					onclick={() => (dfFilter = null)}
				>
					DF {dfFilter} only ✕
				</button>
			{/if}
			<div class="ml-auto flex gap-3 font-mono text-xs">
				<span class={PART_COLORS.header}>DF + control</span>
				<span class={PART_COLORS.address}>ICAO address</span>
				<span class={PART_COLORS.payload}>payload</span>
				<span class={PART_COLORS.parity}>parity</span>
			</div>
		</div>

		<table class="w-full text-sm tabular-nums">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="py-1 font-normal">Received</th>
					<th class="py-1 text-right font-normal">
						<InfoTip label="Signal (dBFS)">
							<p>
								How loud the message arrived, in <strong>dBFS</strong>: decibels relative to the
								loudest signal the dongle can measure (full scale = 0 dBFS).
							</p>
							<p>
								Every −6 dB halves the amplitude, every −10 dB is a tenth of the power. So
								<strong>−20 dBFS</strong> is a tenth of the full-scale amplitude, a hundredth of its power.
							</p>
							<p>
								Usable range here is about −40 (drowning in noise) to −3 dBFS (pulses at full scale; <span
									class="text-rose-400">red</span
								>). Louder usually means closer, but only roughly: transmitter power and antenna
								orientation vary.
							</p>
							<p class="text-zinc-400">
								Relative to your receiver and its current gain, not an absolute power. Hover a value
								for its exact amplitude and power.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 pl-4 font-normal">DF</th>
					<th class="py-1 font-normal">TC</th>
					<th class="py-1 font-normal">ICAO</th>
					<th class="py-1 font-normal">Message</th>
				</tr>
			</thead>
			<tbody>
				{#each feed as f (f.id)}
					<tr class="border-t border-zinc-900">
						<td class="py-0.5 text-zinc-400">{time.format(f.rx)}</td>
						<td class="py-0.5 text-right text-zinc-400" title={signalTitle(f.dbfs)}>
							{f.dbfs.toFixed(1)} dBFS
						</td>
						<td class="py-0.5 pl-4 font-mono" title={DF_NAMES[f.df]}>{f.df}</td>
						<td class="py-0.5 font-mono" title={f.tc === null ? undefined : typeCodeName(f.tc)}>
							{f.tc ?? ''}
						</td>
						<td class="py-0.5 font-mono text-amber-300">{f.icao ?? ''}</td>
						<td class="py-0.5"><HexFrame hex={f.hex} df={f.df} /></td>
					</tr>
				{:else}
					<tr><td colspan="6" class="py-4 text-zinc-500">Waiting for frames…</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
