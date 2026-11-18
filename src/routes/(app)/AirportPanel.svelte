<!--
	An airport's panel (tap its label on the map): its codes, elevation and where it lies from
	the receiver, from the base map's data (lib/map/airports.ts). The IATA code (BER) heads it:
	it's the one most people know.
-->
<script lang="ts">
	import { airportCode, airportSections } from '#lib/describe/airport.ts';
	import type { Airport } from '#lib/map/airports.ts';
	import type { Unit } from '#lib/describe/format.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import Details from './Details.svelte';
	import PanelHeader from './PanelHeader.svelte';

	interface Props {
		airport: Airport;
		receiver: LatLon;
		unit: Unit;
		onclose: () => void;
	}

	let { airport, receiver, unit, onclose }: Props = $props();

	let sections = $derived(airportSections(airport, receiver, unit));
</script>

<PanelHeader {onclose}>
	<h2 class="font-mono text-xl font-semibold">{airportCode(airport)}</h2>
	<p class="text-sm text-zinc-300">{airport.name}</p>
</PanelHeader>
<Details {sections} />
