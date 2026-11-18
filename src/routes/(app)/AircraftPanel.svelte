<!--
	Everything about the selected aircraft: identity, position, flight, autopilot, the weather
	it measures, what radars read from it, reception, and its latest messages. Plus what the airframe database knows
	(adsbdb: photo, type, registration, owner), once the lookup comes back, and about its
	flight (route, airline: looked up by the page, which draws the route on the map too).
-->
<script lang="ts">
	import {
		lookupAircraft,
		type DbAircraft,
		type DbFlight,
		type DbRoute
	} from '#lib/aircraft-db.ts';
	import { aircraftSections } from '#lib/describe/aircraft.ts';
	import { routeText } from '#lib/describe/route.ts';
	import type { Unit } from '#lib/describe/format.ts';
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
	import PanelHeader from './PanelHeader.svelte';

	interface Props {
		aircraft: TrackedAircraft;
		/** Every aircraft: for an ACAS advisory's threat. */
		all: TrackedAircraft[];
		messages: Message[];
		/** adsbdb's route and airline for its callsign; null: none (yet). */
		flight: DbFlight | null;
		/** Whether its route fits (lib/tracker/route.ts); a dismissed one isn't shown. */
		judged: Judged | null;
		/** The route shown (the page's: the map draws it too); null: none, or dismissed. */
		route: DbRoute | null;
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

	let {
		aircraft,
		all,
		messages,
		flight,
		judged,
		route,
		weather,
		now,
		receiver,
		unit,
		onclose
	}: Props = $props();

	// The snapshot is replaced every update; the address isn't, so this looks it up once.
	let icao = $derived(aircraft.icao);
	let db = $state<DbAircraft | null | 'unreachable'>(null);
	$effect(() => {
		let current = true;
		db = null;
		lookupAircraft(icao).then(
			(entry) => {
				if (current) db = entry;
			},
			// Offline or adsbdb down: no photo, and the airframe section says so. The next
			// look retries (lookupAircraft forgets failures).
			() => {
				if (current) db = 'unreachable';
			}
		);
		return () => (current = false);
	});

	let sections = $derived(
		aircraftSections(aircraft, now, receiver, unit, db, flight, judged, all, weather)
	);

	let block = $derived(allocation(aircraft.icao));
</script>

<PanelHeader {onclose}>
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
</PanelHeader>
{#if db && db !== 'unreachable' && db.photo}
	<AircraftPhoto photo={db.photo} registration={db.registration} />
{/if}
<Details {sections} />
<MessageFeed {messages} />
