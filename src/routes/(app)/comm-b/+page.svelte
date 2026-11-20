<script lang="ts">
	import { arrivalTime, n as whole } from '#lib/describe/format.ts';
	import FilterChip from '#lib/components/FilterChip.svelte';
	import LiveHeading from '#lib/components/LiveHeading.svelte';
	import Segmented from '#lib/components/Segmented.svelte';
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { HOW, bitsTitle, inferenceTitle } from '#lib/describe/comm-b.ts';
	import { REGISTER_NAMES } from '#lib/modes/registers.ts';
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
				name: REGISTER_NAMES[key] ?? SPECIAL[key] ?? '?',
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

	/** Registers that start with their own number: the first MB byte. */
	const NUMBERED = new Set(['1,0', '2,0', '3,0']);

	/** Which part of the MB gave the register away by pattern, in hex digits: [from, to). */
	function patternRange(r: RegisterRow): [number, number] | null {
		if (r.inference?.how !== 'fixed') return null;
		if (NUMBERED.has(r.key)) return [0, 2];
		if (r.key === '1,7') return [6, 14]; // bits 25–56: 32 zero bits
		return null;
	}

	const n = (x: number) => (x === 0 ? '' : whole(x));
	const rate = (x: number) => (x === 0 ? '' : `${x.toFixed(1)}/s`);
</script>

<PageTitle page="Comm-B registers" />

<div class="space-y-6">
	<!-- Registers -->
	<section>
		<div class="mb-2 flex">
			<InfoTip heading="h2" class="text-sm font-semibold text-zinc-100" label="Registers" wide>
				<p>
					A Mode S transponder keeps a set of <strong>registers</strong> of 56 bits, each holding
					one kind of data about the flight: <code>4,0</code> the altitude the pilots selected,
					<code>6,0</code> heading and speed. The aircraft broadcasts a few of them by itself; the others
					only go out when a radar asks.
				</p>
				<p>
					In Europe (<a
						href="https://eur-lex.europa.eu/eli/reg_impl/2023/1770/oj/eng"
						target="_blank"
						rel="noreferrer"
						class="text-accent-400 hover:text-accent-300">EU regulation 2023/1770</a
					>), every flight under instrument flight rules must provide
					<strong>Elementary Surveillance</strong>: 1,0, 1,7 and 2,0, plus 3,0 with a collision
					avoidance system (ACAS). Aircraft over 5,700 kg or faster than 250 kt add
					<strong>Enhanced Surveillance</strong>: 4,0, 5,0 and 6,0. Which ones a radar asks for is
					up to its operator.
				</p>
			</InfoTip>
		</div>
		<!-- Fixed layout: only Register takes the remaining width, so changing counts never move
		     the columns. Widths go on <col>: the header's colspan cells can't carry them. -->
		<div class="overflow-x-auto">
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
						<th class="py-1 font-normal">
							<InfoTip label="BDS">
								<p>
									<strong>Comm-B Data Selector</strong>, the register's number: two hexadecimal
									digits (0–9, A–F) written with a comma, so there can be 256, from 0,0 to F,F.
								</p>
								<p>
									The rows below the registers are replies whose register couldn't be told: all
									zeros, several registers fit equally well, or none does.
								</p>
							</InfoTip>
						</th>
						<th class="py-1 font-normal">Register</th>
						<th class="py-1 text-right font-normal" colspan="2">
							<InfoTip label="Broadcast (ADS-B)" align="right">
								<p>
									Sent by the aircraft on its own as DF17, up to twice a second each. The message's
									type code says which register it is.
								</p>
							</InfoTip>
						</th>
						<th class="py-1 text-right font-normal" colspan="2">
							<InfoTip label="Interrogated (Comm-B)" align="right" wide>
								<p>
									Sent when a radar asks for a register, as a reply (DF20 or DF21). The reply
									doesn't say which register it is, and the radar's question goes out on another
									frequency (1030 MHz), so the register has to be inferred:
								</p>
								<ol class="list-decimal space-y-1 pl-5">
									<li>
										<strong>By pattern:</strong> 1,0, 2,0 and 3,0 start with their own number, 1,7 ends
										in 32 zero bits.
									</li>
									<li>
										<strong>Only fit:</strong> every other register is ruled out because the bits make
										no sense for it: a value out of range, a "no data" flag with data behind it, bits
										that must be zero but aren't.
									</li>
									<li>
										<strong>By ADS-B:</strong> if several fit, the one that agrees with what the aircraft
										broadcast wins.
									</li>
									<li>
										<strong>Rarely asked ones</strong> (4,4, 4,5, 5,3, 2,1) only count if nothing else
										fits: random bits fit them by chance now and then.
									</li>
								</ol>
								<p>Radars can ask for the broadcast registers too.</p>
							</InfoTip>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.key)}
						<tr
							class={[
								'cursor-pointer border-t border-zinc-900 hover:bg-zinc-900',
								register === row.key && 'bg-accent-950'
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
			<LiveHeading feed={stream} noun="readings" />
			<Segmented options={SOURCES} bind:value={source} />
			{#if register !== null}
				<FilterChip
					label={register in SPECIAL ? SPECIAL[register] : `BDS ${register}`}
					onclear={() => (register = null)}
				/>
			{/if}
			{#if aircraft !== null}
				<FilterChip label={aircraft} onclear={() => (aircraft = null)} />
			{/if}
		</div>

		<!-- Fixed layout: every column but Content has a set width, sized for its longest value,
		     so new readings never shift the columns; Content gets the rest and wraps. -->
		<!-- Scrolls only below lg: from 1024 px the table fits, and a scroll container would cut
		     off the header tooltips. -->
		<div class="overflow-x-auto">
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
									The register's 56 bits in hex: MB in a Comm-B reply, ME in ADS-B.
									<span class="font-semibold text-zinc-100">Highlighted</span>: what gave the
									register away by pattern.
								</p>
							</InfoTip>
						</th>
						<th class="py-1 font-normal">Content</th>
						<th class="w-56 py-1 font-normal xl:w-72">
							<InfoTip label="vs ADS-B" align="right">
								<p>
									The reading against what the same aircraft broadcast in the last 30 s:
									<span class="text-zinc-300">✓</span> agrees,
									<span class="text-warn-400">✗</span>
									doesn't. Heading is compared with the broadcast track if there's no broadcast heading,
									and gets 30° of leeway: the wind turns the nose away from the track, and heading is
									magnetic, track true. Mach needs no broadcast: at a given altitude, the airspeed in
									the same reading gives it.
								</p>
							</InfoTip>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each feed as r (r.id)}
						{@const range = patternRange(r)}
						<tr class="border-t border-zinc-900">
							<td class="py-0.5 text-zinc-400">{arrivalTime(r.rx)}</td>
							<td class="py-0.5 whitespace-nowrap">
								<button
									class={[
										'font-mono hover:underline',
										r.verdict === 'unknown' ? 'text-zinc-500' : 'text-highlight-300'
									]}
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
									: `${r.key} ${REGISTER_NAMES[r.key] ?? ''}\nBroadcast (ADS-B)`}
							>
								{#if r.inference?.best || !r.inference}
									<span class="font-mono">{r.key}</span>
								{/if}
								{#if r.inference}
									<span
										class={[
											'text-xs',
											r.inference.how === 'unknown' || r.inference.how === 'ambiguous'
												? 'text-warn-400'
												: 'text-zinc-500'
										]}
									>
										{HOW[r.inference.how].label}
									</span>
								{/if}
							</td>
							<td
								class="py-0.5 font-mono text-blue-300"
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
