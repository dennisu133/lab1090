<!--
	Everything about the selected aircraft: identity, position, flight, autopilot, what radars
	read from it, reception, and its latest messages. Plus what the airframe database knows
	(adsbdb: photo, type, registration, owner), once the lookup comes back.
-->
<script lang="ts">
	import { lookupAircraft, type DbAircraft } from '#lib/aircraft-db.ts';
	import { aircraftSections } from '#lib/describe/aircraft.ts';
	import type { Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import Flag from '#lib/components/Flag.svelte';
	import { allocation } from '#lib/modes/nationality.ts';
	import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
	import AircraftPhoto from './AircraftPhoto.svelte';
	import Details from './Details.svelte';
	import MessageFeed from './MessageFeed.svelte';
	import type { Message } from './tracker-stream.svelte.ts';

	interface Props {
		aircraft: TrackedAircraft;
		messages: Message[];
		now: number;
		receiver: LatLon | null;
		unit: Unit;
		onclose: () => void;
	}

	let { aircraft, messages, now, receiver, unit, onclose }: Props = $props();

	// The snapshot is replaced every update; the address isn't, so this looks it up once.
	let icao = $derived(aircraft.icao);
	let db = $state<DbAircraft | null>(null);
	$effect(() => {
		let current = true;
		lookupAircraft(icao).then(
			(entry) => {
				if (current) db = entry;
			},
			// Offline or adsbdb down: no photo, no airframe section; the next look retries.
			() => {}
		);
		return () => (current = false);
	});

	let sections = $derived(aircraftSections(aircraft, now, receiver, unit, db));
	let block = $derived(allocation(aircraft.icao));
</script>

<header class="flex items-start justify-between gap-4 px-4 py-3">
	<div class="min-w-0">
		<h2 class="flex items-center gap-2 font-mono text-xl font-semibold">
			{#if block?.country}
				<Flag country={block.country} name={block.state} />
			{/if}
			<span class="truncate">{aircraft.callsign?.value ?? aircraft.icao}</span>
		</h2>
		<p class="truncate text-sm text-zinc-400">
			{aircraft.callsign ? aircraft.icao : 'no callsign (yet)'}
			{#if aircraft.category}· {aircraft.category.value.name}{/if}
		</p>
	</div>
	<button
		type="button"
		onclick={onclose}
		class="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
		aria-label="Close and show all aircraft">✕</button
	>
</header>
{#if db?.photo}
	<AircraftPhoto photo={db.photo} registration={db.registration} />
{/if}
<Details {sections} />
<MessageFeed {messages} />
