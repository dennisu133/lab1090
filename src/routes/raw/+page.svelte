<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import ReceiverStatus from '#lib/components/ReceiverStatus.svelte';
	import type { Verdict } from '#lib/modes/address-filter.ts';
	import { resolve } from '$app/paths';
	import { DF_NAMES, containmentRadius, typeCodeName } from '#lib/modes/frame.ts';
	import CountTable from './CountTable.svelte';
	import HexFrame, { PART_COLORS } from './HexFrame.svelte';
	import SignalHistogram from './SignalHistogram.svelte';
	import { RawStream } from './raw-stream.svelte';
	import { VERDICTS, addressTitle, interrogatorLabel } from './verdicts';

	const FEED_ROWS = 200;

	let { data } = $props();

	const stream = new RawStream(() => data.reference);
	$effect(() => stream.connect());

	/** Clicking a row in a count table shows only those frames; null = no filter. */
	let filter = $state<{ df: number | null; tc: number | null; verdict: Verdict | null }>({
		df: null,
		tc: null,
		verdict: null
	});
	let chips = $derived(
		[
			{ key: 'df' as const, label: `DF ${filter.df}`, active: filter.df !== null },
			{ key: 'tc' as const, label: `TC ${filter.tc}`, active: filter.tc !== null },
			{ key: 'verdict' as const, label: `${filter.verdict}`, active: filter.verdict !== null }
		].filter((c) => c.active)
	);

	let update = $derived(stream.update);

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

	let verdictRows = $derived(
		(Object.keys(VERDICTS) as Verdict[]).map((v) => ({
			key: v,
			keyText: VERDICTS[v].symbol,
			keyClass: VERDICTS[v].color,
			label: VERDICTS[v].label,
			count: update?.counts.byVerdict[v] ?? 0,
			rate: stream.rates.byVerdict[v] ?? 0
		}))
	);

	let feed = $derived(
		stream.frames
			.filter(
				(f) =>
					(filter.df === null || f.df === filter.df) &&
					(filter.tc === null || (f.df === 17 && f.tc === filter.tc)) &&
					(filter.verdict === null || f.addr?.verdict === filter.verdict)
			)
			.slice(0, FEED_ROWS)
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

	function toggle<K extends keyof typeof filter>(key: K, value: (typeof filter)[K]) {
		filter[key] = filter[key] === value ? null : value;
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
		<ReceiverStatus online={stream.online} {update} />
		<div class="tabular-nums">
			<span class="text-2xl font-semibold">{stream.rates.total.toFixed(1)}</span>
			<span class="text-zinc-400">msg/s</span>
		</div>
		<div class="text-zinc-400">
			{#if data.reference}
				<InfoTip label="Reference point set">
					<p>
						Positions are decoded from single messages, using the <code>REFERENCE_POINT</code>
						from <code>.env</code> to pick the right CPR zone (local decoding). Its coordinates are never
						shown here.
					</p>
					<p>
						When the same aircraft also sent a message from its other grid within 10 s, the even/odd
						pair is decoded too (global decoding, no reference needed). If both agree, the position
						is confirmed: <span class="text-zinc-300">✓ pair</span>. Until then it's
						<span class="text-zinc-300">unconfirmed</span>; if they disagree, the pair wins and the
						row says how far off the reference decode was.
					</p>
				</InfoTip>
			{:else}
				<InfoTip label="No reference point">
					<p>
						Positions are only decoded from even/odd pairs (global decoding), so each aircraft's
						first position message stays undecoded.
					</p>
					<p>
						Set <code>REFERENCE_POINT="lat,lon"</code> in <code>.env</code> to decode single
						messages too (see <code>.env.example</code>).
					</p>
				</InfoTip>
			{/if}
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
			selected={filter.df}
			onselect={(df) => toggle('df', df)}
		/>
		<CountTable
			title="ADS-B type codes (DF17)"
			keyLabel="TC"
			rows={tcRows}
			selected={filter.tc}
			onselect={(tc) => toggle('tc', tc)}
		>
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

	<div class="grid gap-6 lg:grid-cols-2">
		<CountTable
			title="Parity check"
			keyLabel=""
			rows={verdictRows}
			selected={filter.verdict}
			onselect={(v) => toggle('verdict', v)}
		>
			{#snippet info()}
				<p>
					Every Mode S message ends in 24 bits of <strong>parity</strong>: a CRC computed over the
					rest of the message. The receiver recomputes it; if a bit got flipped on the way, it no
					longer matches.
				</p>
				<p>
					<span class={VERDICTS.valid.color}>DF11/17/18</span> send the address in the clear, so the CRC
					can check the whole message.
				</p>
				<p>
					All other formats save 24 bits by XORing the address into the parity. Recomputing the CRC
					gives back the address, but a corrupted message would simply give a <em>different</em>
					address. So it only counts if that aircraft was heard in a checked message within the last 60
					s: <span class={VERDICTS.known.color}>known</span>, or else
					<span class={VERDICTS.unknown.color}>unknown</span>.
				</p>
				<p class="text-zinc-400">
					readsb on the Pi already fixes single-bit errors and drops what fails these checks, so
					expect (almost) only green and blue here. Unknowns show up right after a restart, before
					an aircraft's next DF11/17. Click a row to filter the feed.
				</p>
			{/snippet}
		</CountTable>
		<SignalHistogram counts={update?.counts.bySignal ?? {}} />
	</div>

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
			{#each chips as chip (chip.key)}
				<button
					class="rounded bg-sky-900 px-3 py-1 text-sm hover:bg-sky-800"
					onclick={() => (filter[chip.key] = null)}
				>
					{chip.label} only ✕
				</button>
			{/each}
			<div class="ml-auto flex gap-3 font-mono text-xs">
				<span class={PART_COLORS.header}>DF + control</span>
				<span class={PART_COLORS.address}>ICAO address</span>
				<span class={PART_COLORS.payload}>payload</span>
				<span class={PART_COLORS.parity}>parity</span>
				<span class="text-zinc-500">* address from parity</span>
			</div>
		</div>

		<table class="w-full text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="py-1 font-normal">Received</th>
					<th class="py-1 text-right font-normal whitespace-nowrap">
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
								Usable range here is about −40 (drowning in noise) to −3 dBFS (pulses at full
								scale). Louder usually means closer, but only roughly: transmitter power and antenna
								orientation vary.
							</p>
							<p class="text-zinc-400">
								Relative to your receiver and its current gain, not an absolute power. Hover a value
								for its exact amplitude and power.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 font-normal">DF</th>
					<th class="py-1 font-normal">TC</th>
					<th class="py-1 font-normal">ICAO</th>
					<th class="py-1 font-normal">Parity</th>
					<th class="py-1 font-normal">
						<InfoTip label="Content">
							<p>
								Everything decoded from the message. <span class="text-zinc-100">Bright</span>: the
								headline values. <span class="text-xs text-zinc-500">Dimmed</span>: details.
								<span class="text-orange-400">Orange</span>: worth noticing (alerts, emergencies,
								missing data).
							</p>
							<p>
								Labels are the field names from the specifications (FS, SL, RI, NACp, …), so you can
								look them up. Hover any value for what it means.
							</p>
							<p class="text-zinc-400">
								DF20/21 also carry a Comm-B register (MB): <a
									href={resolve('/comm-b')}
									class="text-sky-400 underline">/comm-b</a
								> works out which one, and decodes it.
							</p>
						</InfoTip>
					</th>
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
						<td class="py-0.5 font-mono" title={DF_NAMES[f.df]}>{f.df}</td>
						<td class="py-0.5 font-mono" title={f.tc === null ? undefined : typeCodeName(f.tc)}>
							{f.tc ?? ''}
						</td>
						{#if f.addr}
							{@const v = VERDICTS[f.addr.verdict]}
							<td
								class={[
									'py-0.5 font-mono',
									f.addr.verdict === 'valid' || f.addr.verdict === 'known'
										? 'text-amber-300'
										: 'text-zinc-500'
								]}
								title={addressTitle(f.addr)}
							>
								{f.addr.icao}<span class="text-zinc-600"
									>{f.addr.source === 'parity' ? '*' : ''}</span
								>
							</td>
							<td class="py-0.5 whitespace-nowrap" title={v.label}>
								<span class={v.color}>{v.symbol}</span>
								<span class="text-xs text-zinc-500">{interrogatorLabel(f.addr) ?? ''}</span>
							</td>
						{:else}
							<td></td>
							<td></td>
						{/if}
						<td class="py-0.5">
							<Fields fields={f.fields} />
						</td>
						<td class="py-0.5"><HexFrame hex={f.hex} df={f.df} /></td>
					</tr>
				{:else}
					<tr>
						<td colspan="8" class="py-4 text-zinc-500">
							{stream.frames.length === 0
								? 'Waiting for frames…'
								: `None of the last ${stream.frames.length} frames match the filter.`}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
