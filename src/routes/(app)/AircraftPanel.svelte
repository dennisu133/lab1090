<!--
	Everything about the selected aircraft: identity, position, flight, autopilot, the weather
	it measures, what radars read from it, reception, and its latest messages. Plus what the airframe database knows
	(adsbdb: photo, type, registration, owner), once the lookup comes back, and about its
	flight (route, airline: looked up by the page, which draws the route on the map too).
-->
<script lang="ts">
	import CloseIcon from '#lib/components/CloseIcon.svelte';
	import { lookupAircraft, type DbAircraft, type DbFlight } from '#lib/aircraft-db.ts';
	import { aircraftSections } from '#lib/describe/aircraft.ts';
	import { routeText } from '#lib/describe/route.ts';
	import type { Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import Flag from '#lib/components/Flag.svelte';
	import { allocation } from '#lib/modes/nationality.ts';
	import type { Judged } from '#lib/tracker/route.ts';
	import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
	import type { HeadingCheck } from '#lib/weather/headings.ts';
	import type { Layer } from '#lib/weather/profile.ts';
	import type { WeatherAircraft } from '#lib/weather/tracker.ts';
	import AircraftPhoto from './AircraftPhoto.svelte';
	import Details from './Details.svelte';
	import MessageFeed from './MessageFeed.svelte';
	import type { Message } from './tracker-stream.svelte.ts';

	interface Props {
		aircraft: TrackedAircraft;
		/** Every aircraft: for an ACAS advisory's threat. */
		all: TrackedAircraft[];
		messages: Message[];
		/** adsbdb's route and airline for its callsign; null: none (yet). */
		flight: DbFlight | null;
		/** Whether its route fits (lib/tracker/route.ts); a dismissed one isn't shown. */
		judged: Judged | null;
		/**
		 * Its wind and temperature (/weather's pipeline), heading check, and the temperature
		 * layer at its level (for the contrail line); null: none.
		 */
		weather: { aircraft: WeatherAircraft; check: HeadingCheck | null; layer: Layer | null } | null;
		now: number;
		receiver: LatLon;
		unit: Unit;
		onclose: () => void;
	}

	let { aircraft, all, messages, flight, judged, weather, now, receiver, unit, onclose }: Props =
		$props();

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

	let sections = $derived(
		aircraftSections(aircraft, now, receiver, unit, db, flight, judged, all, weather)
	);
	let route = $derived(judged?.shown ? (flight?.route ?? null) : null);

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
		<!-- With a route: where it goes (the address and category are under Identity). -->
		{#if route}
			<p class="truncate text-sm text-zinc-300">{routeText(route)}</p>
		{:else}
			<p class="truncate text-sm text-zinc-400">
				{aircraft.callsign ? aircraft.icao : 'no callsign (yet)'}
				{#if aircraft.category}· {aircraft.category.value.name}{/if}
			</p>
		{/if}
	</div>
	<button
		type="button"
		onclick={onclose}
		class="-mr-1.5 grid size-8 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
		aria-label="Close and show all aircraft"><CloseIcon /></button
	>
</header>
{#if db?.photo}
	<AircraftPhoto photo={db.photo} registration={db.registration} />
{/if}
<Details {sections} />
<MessageFeed {messages} />
