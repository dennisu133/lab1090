<script lang="ts">
	import PauseButton from '#lib/components/PauseButton.svelte';
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { HOW, NAMES, bitsTitle, inferenceTitle } from '#lib/describe/comm-b.ts';
	import { DF_NAMES } from '#lib/modes/frame.ts';
	import AircraftTable from './AircraftTable.svelte';
	import PageTitle from '../PageTitle.svelte';
	import { getStreams } from '../streams';
	import type { RegisterRow, Source } from './comm-b-stream.svelte';

	const FEED_ROWS = 200;
	/** Keys that aren't registers, shown last. */
	const SPECIAL: Record<string, string> = {
		empty: 'Empty (all zeros)',
		ambiguous: 'Ambiguous',
		unknown: 'Unknown'
	};

	const stream = getStreams().commB;

	let source = $state<Source | null>(null);
	let register = $state<string | null>(null);
	let aircraft = $state<string | null>(null);

	let rows = $derived(
		Object.entries(stream.counts)
			.map(([key, count]) => ({
				key,
				name: NAMES[key] ?? SPECIAL[key] ?? '?',
				count,
				rate: stream.rates[key] ?? { broadcast: 0, interrogated: 0 }
			}))
			.sort((a, b) => +(a.key in SPECIAL) - +(b.key in SPECIAL) || a.key.localeCompare(b.key))
	);

	let feed = $derived(
		stream.items
			.filter(
				(r) =>
					(source === null || r.source === source) &&
					(register === null || r.key === register) &&
					(aircraft === null || r.icao === aircraft)
			)
			.slice(0, FEED_ROWS)
	);

	const SOURCES: { value: Source | null; label: string }[] = [
		{ value: null, label: 'All' },
		{ value: 'broadcast', label: 'Broadcast (ADS-B)' },
		{ value: 'interrogated', label: 'Interrogated (Comm-B)' }
	];

	const time = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		fractionalSecondDigits: 3,
		hour12: false
	});

	/** Registers that start with their own number: the first MB byte. */
	const NUMBERED = new Set(['1,0', '2,0', '3,0']);

	/** Which part of the MB gave the register away by pattern, in hex digits: [from, to). */
	function patternRange(r: RegisterRow): [number, number] | null {
		if (r.inference?.how !== 'fixed') return null;
		if (NUMBERED.has(r.key)) return [0, 2];
		if (r.key === '1,7') return [6, 14]; // bits 25–56: 32 zero bits
		return null;
	}

	const n = (x: number) => (x === 0 ? '' : x.toLocaleString());
	const rate = (x: number) => (x === 0 ? '' : `${x.toFixed(1)}/s`);
</script>

<PageTitle page="Comm-B registers" />

<div class="space-y-6">
	<!-- Registers -->
	<section>
		<div class="mb-2 flex">
			<InfoTip
				heading="h2"
				class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
				label="Registers"
				wide
			>
				<p>
					A Mode S transponder holds up to 256 <strong>registers</strong> of 56 bits, numbered by
					their <strong>BDS</strong> code: <code>4,0</code> is register 0x40.
					<strong>Broadcast:</strong> ADS-B (DF17) sends a few on its own; the type code says which.
					<strong>Interrogated:</strong> a radar asks for one, and the reply (DF20/21) carries it without
					saying which. We only hear the replies, so the register has to be inferred:
				</p>
				<ol class="list-decimal space-y-1 pl-5">
					<li>
						<strong>By pattern:</strong> 1,0, 2,0 and 3,0 start with their own number, 1,7 ends in 32
						zero bits.
					</li>
					<li>
						<strong>By elimination:</strong> status bits, reserved bits and impossible values rule registers
						out.
					</li>
					<li>
						<strong>By ADS-B:</strong> if several remain, the one that agrees with what the aircraft broadcast
						wins.
					</li>
				</ol>
				<p>
					Which ones radars read is set by EU regulation 1207/2011:
					<strong>Elementary Surveillance</strong> 1,0, 1,7 and 2,0 for every IFR flight (3,0 during
					an ACAS advisory);
					<strong>Enhanced Surveillance</strong> adds 4,0, 5,0 and 6,0 for aircraft over 5,700 kg or faster
					than 250 kt. Rarely asked ones (4,4, 4,5, 5,3, 2,1) are a last resort: random bits fit them
					by chance now and then.
				</p>
			</InfoTip>
		</div>
		<!-- Fixed layout: only Register takes the remaining width, so changing counts never move
		     the columns. Widths go on <col>: the header's colspan cells can't carry them. -->
		<div class="overflow-x-auto lg:overflow-visible">
			<table class="w-full min-w-xl table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
				<colgroup>
					<col class="w-14" />
					<col />
					<col class="w-24" />
					<col class="w-20" />
					<col class="w-24" />
					<col class="w-20" />
				</colgroup>
				<thead class="text-left text-xs text-zinc-500">
					<tr>
						<th class="py-1 font-normal">BDS</th>
						<th class="py-1 font-normal">Register</th>
						<th class="py-1 text-right font-normal" colspan="2">Broadcast (ADS-B)</th>
						<th class="py-1 text-right font-normal" colspan="2">Interrogated (Comm-B)</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.key)}
						<tr
							class={[
								'cursor-pointer border-t border-zinc-900 hover:bg-zinc-900',
								register === row.key && 'bg-sky-950'
							]}
							onclick={() => (register = register === row.key ? null : row.key)}
						>
							<td class="py-0.5 font-mono">{row.key in SPECIAL ? '' : row.key}</td>
							<td class={['py-0.5', row.key in SPECIAL && 'text-zinc-400']}>{row.name}</td>
							<td class="py-0.5 text-right">{n(row.count.broadcast)}</td>
							<td class="py-0.5 text-right text-xs text-zinc-400">{rate(row.rate.broadcast)}</td>
							<td class="py-0.5 text-right">{n(row.count.interrogated)}</td>
							<td class="py-0.5 text-right text-xs text-zinc-400">{rate(row.rate.interrogated)}</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="py-4 text-zinc-500">Waiting for frames…</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<AircraftTable
		aircraft={stream.aircraft}
		now={stream.now}
		selected={aircraft}
		onselect={(icao) => (aircraft = aircraft === icao ? null : icao)}
	/>

	<!-- Feed -->
	<section>
		<div class="mb-2 flex flex-wrap items-center gap-4">
			<h2 class="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Live readings</h2>
			<PauseButton feed={stream} noun="readings" />
			<div class="flex overflow-hidden rounded text-sm">
				{#each SOURCES as s (s.label)}
					<button
						class={[
							'px-3 py-1',
							source === s.value ? 'bg-sky-900' : 'bg-zinc-800 hover:bg-zinc-700'
						]}
						onclick={() => (source = s.value)}
					>
						{s.label}
					</button>
				{/each}
			</div>
			{#if register !== null}
				<button
					class="rounded bg-sky-900 px-3 py-1 text-sm hover:bg-sky-800"
					onclick={() => (register = null)}
				>
					{register in SPECIAL ? SPECIAL[register] : `BDS ${register}`} only ✕
				</button>
			{/if}
			{#if aircraft !== null}
				<button
					class="rounded bg-sky-900 px-3 py-1 text-sm hover:bg-sky-800"
					onclick={() => (aircraft = null)}
				>
					{aircraft} only ✕
				</button>
			{/if}
		</div>

		<!-- Fixed layout: every column but Content has a set width, sized for its longest value,
		     so new readings never shift the columns; Content gets the rest and wraps. -->
		<!-- Scrolls only below lg: from 1024 px the table fits, and a scroll container would cut
		     off the header tooltips. -->
		<div class="overflow-x-auto lg:overflow-visible">
			<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
				<thead class="text-left text-xs text-zinc-500">
					<tr>
						<th class="w-28 py-1 font-normal">Received</th>
						<th class="w-36 py-1 font-normal">Aircraft</th>
						<th class="w-10 py-1 font-normal">DF</th>
						<th class="w-28 py-1 font-normal">BDS</th>
						<th class="w-36 py-1 font-normal">
							<InfoTip label="MB">
								<p>
									The 56 register bits: MB of DF20/21, ME of DF17.
									<span class="font-semibold text-zinc-100">Highlighted</span>: what gave the
									register away by pattern. Hover for the bits in binary.
								</p>
							</InfoTip>
						</th>
						<th class="py-1 font-normal">Content</th>
						<th class="w-56 py-1 font-normal xl:w-72">
							<InfoTip label="vs ADS-B" align="right">
								<p>
									The reading against what the same aircraft broadcast (≤ 30 s earlier):
									<span class="text-zinc-300">✓</span> agrees,
									<span class="text-orange-400">✗</span>
									doesn't. Heading (magnetic, the nose) may differ from track (true, over the ground)
									by up to 30°. Mach is checked against the reply's own airspeed and altitude.
								</p>
							</InfoTip>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each feed as r (r.id)}
						{@const range = patternRange(r)}
						<tr class="border-t border-zinc-900">
							<td class="py-0.5 text-zinc-400">{time.format(r.rx)}</td>
							<td class="py-0.5 whitespace-nowrap">
								<button
									class={[
										'font-mono hover:underline',
										r.verdict === 'unknown' ? 'text-zinc-500' : 'text-amber-300'
									]}
									title="Show only this aircraft"
									onclick={() => (aircraft = aircraft === r.icao ? null : r.icao)}
								>
									{r.icao}
								</button>
								<span class="text-xs text-zinc-500">{r.callsign ?? ''}</span>
							</td>
							<td class="py-0.5 font-mono" title={DF_NAMES[r.df]}>{r.df}</td>
							<td
								class="py-0.5 whitespace-nowrap"
								title={r.inference
									? inferenceTitle(r.inference)
									: `${r.key} ${NAMES[r.key] ?? ''}\nBroadcast: the ADS-B type code says which register.`}
							>
								{#if r.inference?.best || !r.inference}
									<span class="font-mono">{r.key}</span>
								{/if}
								{#if r.inference}
									<span
										class={[
											'text-xs',
											r.inference.how === 'unknown' || r.inference.how === 'ambiguous'
												? 'text-orange-400'
												: 'text-zinc-500'
										]}
									>
										{HOW[r.inference.how].label}
									</span>
								{/if}
							</td>
							<td
								class="py-0.5 font-mono text-sky-300"
								title={bitsTitle(r.mb, r.source === 'broadcast' ? 'ME' : 'MB')}
							>
								{#if range}{r.mb.slice(0, range[0])}<span class="font-semibold text-zinc-100"
										>{r.mb.slice(range[0], range[1])}</span
									>{r.mb.slice(range[1])}{:else}{r.mb}{/if}
							</td>
							<td class="py-0.5"><Fields fields={r.fields} /></td>
							<td class="py-0.5"><Fields fields={r.comparisons} /></td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="py-4 text-zinc-500">
								{stream.items.length === 0
									? 'Waiting for frames…'
									: `None of the last ${stream.items.length} readings match the filter.`}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
