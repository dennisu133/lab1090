<!--
	The card of a wind barb tapped on the map (lib/map/winds.ts): the wind, who measured it
	when, and how. It sits above the barb, kept inside the map sideways, and follows it as the
	map moves.
-->
<script lang="ts">
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import { createSubscriber } from 'svelte/reactivity';
	import CloseIcon from '#lib/components/CloseIcon.svelte';
	import { directionText, flightLevel } from '#lib/describe/format.ts';
	import { compass } from '#lib/geo.ts';
	import type { PickedBarb } from '#lib/map/pick.ts';
	import { MIN_CORRECTION } from '#lib/weather/headings.ts';
	import type { TrackerStream } from './tracker-stream.svelte.ts';
	import type { WeatherStream } from './weather/weather-stream.svelte.ts';

	interface Props {
		map: MapLibreMap;
		picked: PickedBarb;
		stream: TrackerStream;
		weather: WeatherStream;
		onclose: () => void;
	}

	let { map, picked, stream, weather, onclose }: Props = $props();

	/** The card's width (w-64), px, and how close it may come to the map's edges. */
	const WIDTH = 256;
	const MARGIN = 8;

	/** Read where things are on screen again whenever the map moves or changes size. */
	const moved = createSubscriber((update) => {
		map.on('move', update);
		map.on('resize', update);
		return () => {
			map.off('move', update);
			map.off('resize', update);
		};
	});

	/** The barb's point on screen, and the map's width, px. */
	let at = $derived.by(() => {
		moved();
		const { x, y } = map.project([picked.lon, picked.lat]);
		return { x, y, width: map.getContainer().clientWidth };
	});

	/** Who measured it: callsign if known, else the address. */
	let by = $derived.by(() => {
		const icao = picked.barb.icao;
		const tracked = stream.get(icao);
		const callsign =
			tracked?.callsign?.value ?? weather.aircraft.find((a) => a.icao === icao)?.callsign ?? null;
		return { icao, name: callsign ?? icao, tracked: !!tracked };
	});

	let b = $derived(picked.barb);
	let age = $derived(Math.max(0, Math.round((weather.now - b.rx) / 60_000)));
</script>

<div
	class="absolute z-10 w-64 -translate-y-full rounded-md bg-zinc-950/95 px-3 py-2 text-xs text-zinc-300 shadow-lg ring-1 ring-zinc-800"
	style:left="{Math.min(Math.max(at.x - WIDTH / 2, MARGIN), at.width - WIDTH - MARGIN)}px"
	style:top="{at.y - 12}px"
	role="dialog"
	aria-label="Wind barb"
>
	<div class="flex items-start justify-between gap-2">
		<p class="text-sm font-semibold text-zinc-100 tabular-nums">
			{compass(b.direction)}
			{directionText(b.direction)} · {Math.round(b.speed)} kt
			<span class="font-normal text-zinc-400">at {flightLevel(b.altitude)}</span>
		</p>
		<button
			type="button"
			onclick={onclose}
			class="-mt-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
			aria-label="Close"><CloseIcon /></button
		>
	</div>
	<p class="mt-1">
		Measured by
		{#if by.tracked}
			<button
				type="button"
				class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
				onclick={() => {
					stream.select(by.icao);
					onclose();
				}}>{by.name}</button
			>
		{:else}
			<span class="font-mono text-zinc-100">{by.name}</span> (gone){/if}
		{age < 1 ? 'in the last minute' : `${age} min ago`}, here.
	</p>
	<p class="mt-1 text-zinc-400">
		{#if b.from === 'turn'}
			From a turn: its ground speed and track all the way round trace a circle whose centre is the
			wind.
		{:else}
			{b.samples === 1 ? 'From one reading' : `Mean of ${b.samples} readings`}: its ground vector
			minus its air vector (registers 5,0 and 6,0).{#if b.corrected}
				Its heading was turned {Math.abs(b.corrected).toFixed(1)}° first: the other aircraft's winds
				say it's off (at least {MIN_CORRECTION}°).{/if}
		{/if}
		The staff points where the wind comes from.
	</p>
</div>
