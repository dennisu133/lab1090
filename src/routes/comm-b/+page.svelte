<script lang="ts">
	import PauseButton from '#lib/components/PauseButton.svelte';
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import ReceiverStatus from '#lib/components/ReceiverStatus.svelte';
	import { HOW, NAMES, bitsTitle, inferenceTitle } from '#lib/describe/comm-b.ts';
	import { DF_NAMES } from '#lib/modes/frame.ts';
	import AircraftTable from './AircraftTable.svelte';
	import { CommBStream, type RegisterRow, type Source } from './comm-b-stream.svelte';

	const FEED_ROWS = 200;
	/** Keys that aren't registers, shown last. */
	const SPECIAL: Record<string, string> = {
		empty: 'Empty (all zeros)',
		ambiguous: 'Ambiguous',
		unknown: 'Unknown'
	};

	const stream = new CommBStream();
	$effect(() => stream.connect());

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

<svelte:head>
	<title>Comm-B registers · ADS-B</title>
</svelte:head>

<div class="space-y-6">
	<header
		class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm"
	>
		<ReceiverStatus online={stream.online} update={stream.update} />
		<div class="text-zinc-400">
			<InfoTip label="What is a register?" wide>
				<p>
					A Mode S transponder holds up to 256 <strong>registers</strong> of 56 bits each, numbered
					by their <strong>BDS</strong> code (Comm-B Data Selector), written as two hex digits:
					<code>4,0</code> is register 0x40. The aircraft's computers keep them up to date: callsign,
					selected altitude, speeds, heading, position.
				</p>
				<p>
					<strong>Broadcast:</strong> ADS-B (DF17) is the aircraft sending a few registers on its own,
					twice a second, to everyone. The type code says which: TC 19 is register 0,9.
				</p>
				<p>
					<strong>Interrogated:</strong> a radar asks one aircraft for one register, and the reply (DF20/21)
					carries its 56 bits in the MB field. The radar knows which register it asked for; the reply
					doesn't say, so a receiver that only listens has to work it out.
				</p>
				<p class="text-zinc-400">
					Not to be confused with a "Comm-B broadcast" (DR 4/5 on /frames): that's the aircraft
					telling every radar it has a new message waiting. It's still read out by interrogation.
				</p>
			</InfoTip>
		</div>
		<div class="text-zinc-400">
			<InfoTip label="How the register is inferred" wide>
				<ol class="list-decimal space-y-2 pl-5">
					<li>
						<strong>By pattern.</strong> 1,0, 2,0 and 3,0 start with their own number (0x10, 0x20, 0x30);
						1,7 always ends in 32 zero bits. If one fits, that's it.
					</li>
					<li>
						<strong>By elimination.</strong> Most registers put a status bit before each value: 0 means
						"no data", so the value bits must then be zero. Reserved bits must be zero, and values must
						be possible (no 900 kt airliners). Often only one register survives.
					</li>
					<li>
						<strong>By ADS-B.</strong> If several survive (5,0 and 6,0 often do), each reading is compared
						with what the same aircraft broadcast: ground speed, track, heading, airspeed. The one that
						agrees wins.
					</li>
				</ol>
				<p>
					Some registers have no structure to speak of: 5,1/5,2 (position reports) and ADS-B
					registers a radar reads via Comm-B (0,5, 0,6, 0,8, 0,9, 6,1, 6,2, 6,5). They only count if
					ADS-B confirms them: same position, same altitude, or simply the same 56 bits.
				</p>
				<p>
					A few registers are hardly ever asked for: 4,4 and 4,5 (weather reports), 5,3 (speeds
					through the air) and 2,1 (the registration, e.g. D-AIZA). With enough random bits, one of
					them fits now and then by chance, so they are a last resort: only considered when no other
					register fits, and never if ADS-B disagrees.
				</p>
				<p>
					2,1 needs a second opinion too, from the address: ICAO gives each country a block of
					addresses, so 3C6586 is German, and a German registration starts with D. Seven random
					letters rarely start with the right one.
				</p>
				<p>
					The checks for 1,0–6,0, 4,4 and 4,5 are pyModeS's (and tested against it); 5,3 and 2,1
					follow ICAO Doc 9871. 5,1 and 5,2 aren't in any public spec; their layout was worked out
					from this receiver's own data.
				</p>
				<p class="text-zinc-400">
					Hover a register in the feed for its reasoning: what fitted, and why everything else was
					ruled out.
				</p>
			</InfoTip>
		</div>
		<div class="text-zinc-400">
			<InfoTip label="Which registers radars read" wide align="right">
				<p>
					Not just any: European rules (EU regulation 1207/2011) say which registers the radars
					read, and which aircraft must provide them.
				</p>
				<p>
					<strong>Elementary Surveillance (ELS)</strong>, for every flight under instrument rules:
					1,0 and 1,7 (what the transponder can do), 2,0 (callsign), and 3,0 when ACAS issues a
					resolution advisory.
				</p>
				<p>
					<strong>Enhanced Surveillance (EHS)</strong>, for aircraft over 5,700 kg or faster than
					250 kt, adds the "downlinked aircraft parameters": 4,0 (selected altitude), 5,0 (track,
					speeds, roll) and 6,0 (heading, airspeed, Mach, vertical rate). That's why these three
					dominate the table above. The Aircraft table shows them per aircraft.
				</p>
				<p>
					<strong>How a radar asks:</strong> its interrogation, on 1030 MHz, names the register in its
					RR field (and a subfield for the second digit). The aircraft answers on 1090 MHz. This receiver
					only listens on 1090 MHz: it hears every answer but none of the questions, hence the inference.
				</p>
				<p>
					That's <strong>ground-initiated Comm-B</strong> (GICB), and all you see here. An aircraft can
					also start a conversation: it sets DR in its replies (see /frames) to say it has a message,
					for example a new resolution advisory, and the radar then reads it out the same way (air-initiated
					Comm-B).
				</p>
				<p class="text-zinc-400">
					The rest: some radars also read the ADS-B registers (0,5, 0,9, …), probably to check them
					against their own measurement. 5,1/5,2 aren't in any public spec. The weather registers
					(4,4, 4,5) are only asked for by a few radars that feed weather services.
				</p>
			</InfoTip>
		</div>
	</header>

	<!-- Registers -->
	<section>
		<h2 class="mb-2 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
			Registers since this page opened
		</h2>
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
							<td class="py-0.5 text-right text-xs text-zinc-500">{rate(row.rate.broadcast)}</td>
							<td class="py-0.5 text-right">{n(row.count.interrogated)}</td>
							<td class="py-0.5 text-right text-xs text-zinc-500">{rate(row.rate.interrogated)}</td>
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
		     off the header tooltips when the table is shorter than they are. -->
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
									The 56 register bits as hex: the <strong>MB</strong> field of a DF20/21 reply. For
									broadcasts it's the <strong>ME</strong> field of DF17: the same register, sent unasked.
								</p>
								<p>
									Hover for the bits in binary, numbered like the spec tables (bit 1 first), to
									check the reasoning in the BDS column yourself.
								</p>
								<p>
									<span class="font-semibold text-zinc-100">Highlighted</span>: what gave a register
									away by pattern. 1,0, 2,0 and 3,0 start with their own number (<span
										class="font-mono">10</span
									>, <span class="font-mono">20</span>, <span class="font-mono">30</span>); 1,7 ends
									in 32 zero bits (<span class="font-mono">00000000</span>).
								</p>
							</InfoTip>
						</th>
						<th class="py-1 font-normal">Content</th>
						<th class="w-56 py-1 font-normal xl:w-72">
							<InfoTip label="vs ADS-B" align="right">
								<p>
									The Comm-B reading next to what the same aircraft broadcast via ADS-B (at most 30
									s earlier): <span class="text-zinc-300">✓</span> agrees within the allowed
									difference,
									<span class="text-orange-400">✗</span> doesn't. Hover for both values.
								</p>
								<p>
									Some differences are expected. Heading (6,0) is where the nose points, relative to
									magnetic north; ADS-B gives the track over the ground, relative to true north.
									Wind and the magnetic declination both add up, so up to 30° is allowed.
								</p>
								<p>
									Mach is checked against the reply itself: indicated airspeed and pressure altitude
									fix the Mach number, whatever the temperature.
								</p>
								<p class="text-zinc-400">
									Replies whose address can't be verified (unknown on /frames) are not compared.
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
