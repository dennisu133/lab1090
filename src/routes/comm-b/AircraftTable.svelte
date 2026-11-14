<!--
	One row per aircraft with verified Comm-B replies: the latest Enhanced Surveillance
	readings (4,0, 5,0, 6,0) and which registers the radars read, next to what 1,7 says
	the transponder has. Clicking a row selects the aircraft (the page filters its feed).
-->
<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { NAMES, registerFields } from '#lib/describe/comm-b.ts';
	import type { Field } from '#lib/describe/frame.ts';
	import { GICB_MAP, type Register } from '#lib/modes/registers.ts';
	import {
		AIRCRAFT_TTL_MS,
		registerStatuses,
		type CommBAircraft,
		type Reading,
		type RegisterStatus
	} from './aircraft';

	/** Readings older than this are marked: the radars stopped asking, the value may be outdated. */
	const STALE_MS = 30_000;

	interface Props {
		aircraft: CommBAircraft[];
		/** The latest frame's time, for ages. */
		now: number;
		selected: string | null;
		onselect: (icao: string) => void;
	}

	let { aircraft, now, selected, onselect }: Props = $props();

	const seconds = (rx: number) => `${Math.max(0, Math.round((now - rx) / 1000))} s`;

	const isStale = (reading: Reading<Register> | null) =>
		reading !== null && now - reading.rx > STALE_MS;

	/**
	 * A stale reading is dimmed rather than marked with an extra field: an extra field could
	 * wrap onto a fourth line and make the row taller.
	 */
	function readingFields(reading: Reading<Register> | null): Field[] {
		if (!reading) return [];
		const fields = registerFields(reading.value);
		if (!isStale(reading)) return fields;
		const age = `\n\nRead ${seconds(reading.rx)} ago: no radar has asked for it since, so it may be out of date`;
		return fields.map((f) => ({ ...f, title: f.title + age }));
	}

	const STATUS: Record<RegisterStatus, { color: string; text: string }> = {
		read: { color: 'text-zinc-200', text: 'read by a radar' },
		'not read': {
			color: 'text-zinc-600',
			text: 'listed in 1,7 as available, but no radar has read it here'
		},
		'not listed': {
			color: 'text-orange-400',
			text: "read, but 1,7 doesn't list it: either 1,7 is out of date, or the register was inferred wrongly"
		}
	};

	function registerTitle(a: CommBAircraft, bds: string, status: RegisterStatus): string {
		const name = `${bds} ${NAMES[bds] ?? '?'}: ${STATUS[status].text}`;
		const r = a.registers[bds];
		return r ? `${name}\n${r.count}×, last ${seconds(r.lastRx)} ago` : name;
	}
</script>

<section>
	<div class="mb-2 flex">
		<InfoTip
			heading="h2"
			class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
			label="Aircraft"
			wide
		>
			<p>
				Every aircraft whose Comm-B replies we can verify (a <strong>known</strong> address on
				/frames), heard in the last {AIRCRAFT_TTL_MS / 1000} s. Sorted by address, so rows stay put.
			</p>
			<p>
				The middle columns are the three <strong>Enhanced Surveillance</strong> registers: the
				latest reading of each. Together they tell a controller what the aircraft is <em>about</em>
				to do, which the radar's own track only shows later. A reading older than {STALE_MS / 1000} s
				is dimmed: no radar has asked for it since.
			</p>
			<p class="text-zinc-400">
				Click a row to show only that aircraft's readings below. Hover any value for what it means.
			</p>
		</InfoTip>
	</div>

	<!-- Fixed layout: the register columns share what the fixed ones leave, so new readings
	     wrap inside their cell instead of moving the columns. -->
	<div class="overflow-x-auto">
		<table class="w-full min-w-6xl table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="w-36 py-1 font-normal">Aircraft</th>
					<th
						class="w-18 py-1 text-right font-normal"
						title="Comm-B replies since the aircraft appeared here"
					>
						Replies
					</th>
					<th class="w-14 py-1 text-right font-normal" title="Seconds since its last Comm-B reply">
						Last
					</th>
					<th class="py-1 font-normal">
						<InfoTip label="4,0 Intention">
							<p>
								<strong>Selected vertical intention</strong>: the altitude the crew dialled in on
								the autopilot panel (MCP/FCU), the one the flight management computer (FMS) plans,
								the altimeter setting and the autopilot modes.
							</p>
							<p>
								Why controllers want it: if the crew set a different level than they were cleared
								to, it shows up here before the aircraft gets there. Catching these "level busts"
								early is one of the main reasons Europe made Enhanced Surveillance mandatory.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 font-normal">
						<InfoTip label="5,0 Track and turn">
							<p>
								<strong>Track and turn report</strong>: the path over the ground (track, ground
								speed), the speed through the air (true airspeed), and how the aircraft is turning:
								the bank (roll) angle and how fast the track changes.
							</p>
							<p>
								A radar needs several sweeps to notice a turn in its track. The roll angle shows it
								the moment the pilot banks.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 font-normal">
						<InfoTip label="6,0 Heading and speed" align="right">
							<p>
								<strong>Heading and speed report</strong>: where the nose points (magnetic heading),
								the indicated airspeed the pilots fly by, the Mach number, and the vertical rate.
							</p>
							<p>
								Heading is not track: the wind pushes the aircraft sideways, so the nose points a
								few degrees off the path over the ground. Controllers give headings ("turn left
								heading 270"), so this is the value they check.
							</p>
						</InfoTip>
					</th>
					<th class="w-80 py-1 font-normal">
						<InfoTip label="Registers" align="right">
							<p>
								Every register a radar read from this aircraft, plus the ones it says it has.
								Register
								<strong>1,7</strong> (the GICB capability report) is the transponder's own list: one bit
								per register a radar can read.
							</p>
							<p>
								<span class={STATUS.read.color}>Bright</span>: read.
								<span class={STATUS['not read'].color}>Dark</span>: in 1,7's list, not read here.
								<span class={STATUS['not listed'].color}>Orange</span>: read, but not in 1,7's list.
							</p>
							<p class="text-zinc-400">
								1,7 has no bit for 1,0, 1,7 and 3,0, so those are never orange. Until a radar reads
								1,7, only the read registers are shown.
							</p>
						</InfoTip>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each aircraft as a (a.icao)}
					<tr
						class={[
							// h-16: three lines (3 × 20 px) plus padding, the most a row needs at the
							// table's minimum width, so rows don't grow and shrink as readings change.
							'h-16 cursor-pointer border-t border-zinc-900 align-top hover:bg-zinc-900',
							selected === a.icao && 'bg-sky-950'
						]}
						onclick={() => onselect(a.icao)}
					>
						<td class="py-0.5 whitespace-nowrap">
							<button class="font-mono text-amber-300" aria-pressed={selected === a.icao}>
								{a.icao}
							</button>
							<span class="text-xs text-zinc-500">{a.callsign ?? ''}</span>
						</td>
						<td class="py-0.5 text-right">{a.replies.toLocaleString()}</td>
						<td class="py-0.5 text-right text-zinc-400">{seconds(a.lastRx)}</td>
						{#each [a.intention, a.trackAndTurn, a.headingAndSpeed] as reading, i (i)}
							<td class={['py-0.5', isStale(reading) && 'opacity-40']}>
								<Fields fields={readingFields(reading)} />
							</td>
						{/each}
						<td class="py-0.5">
							<div class="flex flex-wrap gap-x-2 font-mono text-xs leading-5">
								{#each registerStatuses(a, GICB_MAP) as { bds, status } (bds)}
									<span class={STATUS[status].color} title={registerTitle(a, bds, status)}
										>{bds}</span
									>
								{/each}
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="py-4 text-zinc-500"
							>No verified Comm-B replies in the last minute.</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
