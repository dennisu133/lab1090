<script lang="ts">
	import { arrivalTime, dbfs } from '#lib/describe/format.ts';
	import FilterChip from '#lib/components/FilterChip.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import LiveHeading from '#lib/components/LiveHeading.svelte';
	import Fields from '#lib/components/Fields.svelte';
	import { isEmpty, matches, type FrameQuery } from '#lib/frame-query.ts';
	import type { Verdict } from '#lib/modes/address-filter.ts';
	import { DF_NAMES, TYPE_CODE_GROUPS, typeCodeName } from '#lib/modes/frame.ts';
	import { containmentText } from '#lib/describe/frame.ts';
	import CountTable from './CountTable.svelte';
	import HexFrame, { PART_COLORS } from './HexFrame.svelte';
	import SignalHistogram from './SignalHistogram.svelte';
	import PageTitle from '../PageTitle.svelte';
	import { getStreams } from '../streams';
	import type { FeedFrame } from './frame-stream.svelte';
	import { VERDICTS, addressTitle, interrogatorLabel } from './verdicts';

	const FEED_ROWS = 200;

	const { frames: stream, stats } = getStreams();

	/**
	 * Clicking a row in a count table shows only those frames; null = no filter.
	 * tc is a TC table row key: a group ("9–18") or a single code ("11").
	 */
	let filter = $state<{ df: number | null; tc: string | null; verdict: Verdict | null }>({
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

	let counts = $derived(stats.counts);

	/** Every defined format, received or not (plus any undefined one that shows up). */
	let dfRows = $derived.by(() => {
		const byDf = counts?.byDf ?? {};
		const dfs = new Set([...Object.keys(DF_NAMES), ...Object.keys(byDf)].map(Number));
		return [...dfs]
			.sort((a, b) => a - b)
			.map((df) => ({
				key: df,
				label: DF_NAMES[df] ?? 'Unknown',
				count: byDf[df] ?? 0,
				rate: stats.rates.byDf[df] ?? 0
			}));
	});

	/** All type codes: one row per group, which expands into its codes. */
	let tcRows = $derived.by(() => {
		const byTc = counts?.byTc ?? {};
		const row = (tc: number) => ({
			key: `${tc}`,
			label: codeLabel(tc),
			title: `TC ${tc}: ${typeCodeName(tc)}`,
			count: byTc[tc] ?? 0,
			rate: stats.rates.byTc[tc] ?? 0
		});
		return TYPE_CODE_GROUPS.map((g) => {
			const codes = [];
			for (let tc = g.from; tc <= g.to; tc++) codes.push(row(tc));
			return {
				key: codeRange(g),
				label: g.name,
				count: codes.reduce((sum, c) => sum + c.count, 0),
				rate: codes.reduce((sum, c) => sum + c.rate, 0),
				children: codes.length > 1 ? codes : undefined
			};
		});
	});

	/** "9–18", or just "19". Also the TC table's row keys. */
	function codeRange(g: { from: number; to: number }) {
		return g.from === g.to ? `${g.from}` : `${g.from}–${g.to}`;
	}

	/** A TC table row key ("9–18" or "11") back to its range of codes. */
	function parseRange(key: string) {
		const [from, to = from] = key.split('–').map(Number);
		return { from, to };
	}

	/** What a type code adds to its group's meaning. */
	function codeLabel(tc: number) {
		const rc = containmentText(tc);
		if (rc) return `Rc ${rc}`;
		return EMITTER_SETS[tc] ?? typeCodeName(tc);
	}

	/** Identification messages: the type code says which set the emitter category is from. */
	const EMITTER_SETS: Record<number, string> = {
		1: 'Set D: reserved',
		2: 'Set C: ground vehicles, obstacles',
		3: 'Set B: gliders, balloons, drones…',
		4: 'Set A: aircraft by size'
	};

	let verdictRows = $derived(
		(Object.keys(VERDICTS) as Verdict[]).map((v) => ({
			key: v,
			keyText: VERDICTS[v].symbol,
			keyClass: VERDICTS[v].color,
			label: VERDICTS[v].label,
			count: counts?.byVerdict[v] ?? 0,
			rate: stats.rates.byVerdict[v] ?? 0,
			// The demodulator drops them; only a Beast feed from another decoder could send some.
			zeroNote: v === 'invalid' ? 'dropped before they get here' : undefined
		}))
	);

	let query = $derived<FrameQuery>({
		df: filter.df,
		tc: filter.tc === null ? null : parseRange(filter.tc),
		verdict: filter.verdict
	});
	/** Server start: frame ids, and the stored frames, belong to one server run. */
	let since = $derived(stats.since ?? undefined);

	/**
	 * With a filter set: the latest matching frames the server stored, newest first, so rare
	 * ones show up even when they're long gone from the live list. null while loading.
	 */
	let stored = $state.raw<FeedFrame[] | null>([]);
	$effect(() => {
		const q = query;
		const run = since;
		if (isEmpty(q) || run === undefined) {
			stored = [];
			return;
		}
		stored = null;
		const controller = new AbortController();
		stream.lookup(q, controller.signal).then(
			(r) => {
				// From a server run that already ended? Then the new `since` looks again.
				if (r.since === run) stored = r.frames;
			},
			(e) => {
				if (controller.signal.aborted) return;
				console.error(e);
				stored = [];
			}
		);
		return () => controller.abort();
	});

	/** Live frames matching the filter, plus the stored ones the live list doesn't have. */
	let feed = $derived.by(() => {
		const live = stream.frames.filter((f) =>
			matches(query, { df: f.df, tc: f.tc, verdict: f.addr?.verdict ?? null })
		);
		if (!stored?.length) return live.slice(0, FEED_ROWS);
		const ids = new Set(live.map((f) => f.id));
		return [...live, ...stored.filter((f) => !ids.has(f.id))]
			.sort((a, b) => b.id - a.id)
			.slice(0, FEED_ROWS);
	});

	function signalTitle(level: number) {
		const amplitude = 10 ** (level / 20) * 100;
		const power = 10 ** (level / 10) * 100;
		return `${dbfs(level)}: amplitude ${amplitude.toFixed(1)} %, power ${power.toFixed(2)} % of full scale`;
	}

	function toggle<K extends keyof typeof filter>(key: K, value: (typeof filter)[K]) {
		filter[key] = filter[key] === value ? null : value;
	}
</script>

<PageTitle page="Frames" />

<!-- The feed follows the counts directly: the histogram's axis labels already leave room. -->
<div>
	<!-- Counts -->
	<!-- Side by side only from xl: at 1024 px two columns leave too little room for the names. -->
	<div class="grid gap-6 xl:grid-cols-2">
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
					The first 5 bits of the payload say what kind of message it is: identification, position,
					velocity, status…
				</p>
				<p>
					A position message's type code also sets its <strong>containment radius Rc</strong>: the
					aircraft guarantees its true position is inside this circle unless its navigation fails
					unnoticed. That's a limit, not the typical error (NACp). Where a row says "or", the code
					alone isn't enough: the aircraft's status message (TC 31) and a bit in the position
					message pick the radius.
				</p>
			{/snippet}
		</CountTable>
	</div>

	<div class="mt-6 grid gap-6 xl:grid-cols-2">
		<CountTable
			title="Parity check"
			keyLabel=""
			rows={verdictRows}
			selected={filter.verdict}
			onselect={(v) => toggle('verdict', v)}
		>
			{#snippet info()}
				<p>
					The last 24 bits of every message are a <strong>CRC</strong>, a checksum: the transponder
					computes it from the rest of the message, the receiver computes it again, and a single
					wrong bit makes the two differ.
				</p>
				<p>
					In <span class={VERDICTS.valid.color}>DF11/17/18</span> the aircraft's address is sent
					openly, and an intact message checks out to zero. The other formats save space by mixing
					the address into the CRC, so the check leaves the address instead of zero. A corrupted
					message then leaves a random address, a made-up aircraft. So it's only trusted if that
					aircraft was heard in a checked message within the last 60 s (<span
						class={VERDICTS.known.color}>known</span
					>, else <span class={VERDICTS.unknown.color}>unknown</span>).
				</p>
				<p>
					A DF11 reply to a radar mixes in that radar's code the same way; the feed shows it as II
					1–15 or SI 1–63. II 0 means no radar was named, usually the aircraft announcing itself
					about once a second. <span class={VERDICTS.unknown.color}>IC n?</span> is a code no radar has:
					some of the last 7 bits were received wrong, but the address is almost certainly right.
				</p>
				<p>
					Like most receivers, lab1090 drops corrupted messages and parity replies from aircraft it
					hasn't heard before they get here, so <span class={VERDICTS.unknown.color}>unknown</span> stays
					small.
				</p>
			{/snippet}
		</CountTable>
		<SignalHistogram counts={counts?.bySignal ?? {}} />
	</div>

	<!-- Feed -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<LiveHeading feed={stream} noun="frames" />
			{#each chips as chip (chip.key)}
				<FilterChip label={chip.label} onclear={() => (filter[chip.key] = null)} />
			{/each}
		</div>

		<!-- Fixed layout: every column but Content has a set width, sized for its longest value,
		     so new frames never shift the columns; Content gets the rest and wraps. -->
		<!-- Scrolls only below lg: from 1024 px the table fits. -->
		<div class="overflow-x-auto">
			<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
				<thead class="text-left text-xs text-zinc-500">
					<tr>
						<th class="w-28 py-1 font-normal">Received</th>
						<th class="w-32 py-1 text-right font-normal whitespace-nowrap"> Signal (dBFS) </th>
						<th class="w-10 py-1 font-normal">DF</th>
						<th class="w-10 py-1 font-normal">TC</th>
						<th class="w-20 py-1 font-normal">ICAO</th>
						<th class="w-20 py-1 font-normal">Parity</th>
						<th class="py-1 font-normal"> Content </th>
						<th class="w-66 py-1 font-normal">
							<InfoTip label="Message" align="right">
								<p>The message as received, in hex: two characters per byte, 14 or 28 in all.</p>
								<ul class="space-y-1">
									<li>
										<span class={PART_COLORS.header}>DF + control</span>: the format and its control
										fields (CA, FS, …)
									</li>
									<li>
										<span class={PART_COLORS.address}>ICAO address</span>: the aircraft's 24-bit
										address, sent openly in DF11/17/18
									</li>
									<li>
										<span class={PART_COLORS.payload}>payload</span>: 56 bits of data, e.g. the
										ADS-B message (DF17/18) or a Comm-B register (DF20/21)
									</li>
									<li>
										<span class={PART_COLORS.parity}>parity</span>: the CRC. The other formats mix
										the address into it; the ICAO column marks an address recovered from it with *.
									</li>
								</ul>
							</InfoTip>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each feed as f (f.id)}
						<tr class="border-t border-zinc-900">
							<td class="py-0.5 text-zinc-400">{arrivalTime(f.rx)}</td>
							<td class="py-0.5 text-right text-zinc-400" title={signalTitle(f.dbfs)}>
								{dbfs(f.dbfs)}
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
											? 'text-highlight-300'
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
								{isEmpty(query)
									? 'Waiting for frames…'
									: stored === null
										? 'Looking for stored frames…'
										: 'No frames match the filter.'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
