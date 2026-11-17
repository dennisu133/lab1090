<!--
	One row per aircraft with verified Comm-B replies: the latest Enhanced Surveillance
	readings (4,0, 5,0, 6,0) and which registers the radars read, next to what 1,7 says
	the transponder has. Clicking a row selects the aircraft (the page filters its feed).
-->
<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { NAMES, registerFields } from '#lib/describe/comm-b.ts';
	import type { Field } from '#lib/describe/field.ts';
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
				Aircraft whose Comm-B replies can be verified, heard in the last {AIRCRAFT_TTL_MS / 1000} s. The
				middle columns are the latest <strong>Enhanced Surveillance</strong> readings, dimmed after {STALE_MS /
					1000} s without a new one.
			</p>
		</InfoTip>
	</div>

	<!-- Fixed layout: the register columns share what the fixed ones leave, so new readings
	     wrap inside their cell instead of moving the columns. -->
	<!-- Scrolls only below lg: from 1024 px the table fits, and a scroll container would cut
	     off the header tooltips when the table is shorter than they are. -->
	<div class="overflow-x-auto lg:overflow-visible">
		<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
			<thead class="text-left text-xs text-zinc-500">
				<tr>
					<th class="w-32 py-1 font-normal xl:w-36">Aircraft</th>
					<th
						class="w-16 py-1 text-right font-normal xl:w-18"
						title="Comm-B replies since the aircraft appeared here"
					>
						Replies
					</th>
					<th class="w-12 py-1 text-right font-normal xl:w-14">Last</th>
					<th class="py-1 font-normal">
						<InfoTip label="4,0 Intention">
							<p>
								The altitude set on the autopilot panel (MCP/FCU) or planned by the FMS, the
								altimeter setting and the autopilot modes. Shows a level bust before it happens.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 font-normal">
						<InfoTip label="5,0 Track and turn">
							<p>
								Track, ground speed, true airspeed, roll angle and track rate. A turn shows the
								moment the pilot banks, sweeps before the radar's own track does.
							</p>
						</InfoTip>
					</th>
					<th class="py-1 font-normal">
						<InfoTip label="6,0 Heading and speed" align="right">
							<p>
								Magnetic heading (where the nose points, not the track: the wind pushes it
								sideways), indicated airspeed, Mach and vertical rate.
							</p>
						</InfoTip>
					</th>
					<th class="w-52 py-1 font-normal xl:w-80">
						<InfoTip label="Registers" align="right">
							<p>
								What radars read, against <strong>1,7</strong>, the transponder's own list of what
								it has. <span class={STATUS.read.color}>Bright</span>: read.
								<span class={STATUS['not read'].color}>Dark</span>: listed, not read.
								<span class={STATUS['not listed'].color}>Orange</span>: read, not listed.
							</p>
						</InfoTip>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each aircraft as a (a.icao)}
					<tr
						class={[
							// A fixed height, so rows don't grow and shrink as readings change: the most a
							// row needs, plus padding. From xl that's three lines (3 × 20 px); narrower,
							// the reading columns need a fourth.
							'h-20 cursor-pointer border-t border-zinc-900 align-top hover:bg-zinc-900 xl:h-16',
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
