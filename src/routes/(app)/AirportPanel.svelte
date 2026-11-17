<!--
	An airport's panel (tap its label on the map): its codes, elevation and where it lies from
	the receiver, from the base map's data (lib/map/airports.ts). The IATA code (BER) heads it:
	it's the one most people know.
-->
<script lang="ts">
	import CloseIcon from '#lib/components/CloseIcon.svelte';
	import { airportCode, airportSections } from '#lib/describe/airport.ts';
	import type { Airport } from '#lib/map/airports.ts';
	import type { Unit } from '#lib/map/features.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import Details from './Details.svelte';

	interface Props {
		airport: Airport;
		receiver: LatLon;
		unit: Unit;
		onclose: () => void;
	}

	let { airport, receiver, unit, onclose }: Props = $props();

	let sections = $derived(airportSections(airport, receiver, unit));
</script>

<header class="flex items-start justify-between gap-4 px-4 py-3">
	<div class="min-w-0">
		<h2 class="font-mono text-xl font-semibold">{airportCode(airport)}</h2>
		<p class="text-sm text-zinc-300">{airport.name}</p>
	</div>
	<button
		type="button"
		onclick={onclose}
		class="-mr-1.5 grid size-8 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
		aria-label="Close and show all aircraft"><CloseIcon /></button
	>
</header>
<Details {sections} />
