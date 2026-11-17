<!--
	/setup: where the antenna is. Every page sends you here until it's set (the (app)
	layout's load); afterwards the receiver's panel links back, to correct it.

	Two ways, side by side: search the address (Nominatim, from this browser: geocode.ts) or
	enter coordinates (typed, or a map link: coordinates.ts). Either way the spot shows on a
	map before it's saved, with how exact it is. Saving posts to the server, which writes the
	config file and sends you to the map; tabs open elsewhere reload with the new position.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import logo from '#lib/assets/logo.svg';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { METRES_PER_DEGREE, parseCoordinates } from '#lib/setup/coordinates.ts';
	import { MIN_INTERVAL_MS, searchAddress, type Place } from '#lib/setup/geocode.ts';
	import PositionMap from './PositionMap.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * How far off the position may be. Coverage needs ~100 m (the ground height under the
	 * antenna, nearby obstacles); beyond that, a warning. Beyond a kilometre, it can't be
	 * saved: distances and the coverage would be wrong, and coordinates or a house number fix it.
	 */
	const GOOD_M = 100;
	const MAX_M = 1000;

	let mode = $state<'address' | 'coordinates'>('address');

	// Address search.
	let query = $state('');
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let places = $state.raw<Place[] | null>(null);
	let picked = $state<Place | null>(null);
	let lastRequest = 0;
	/** Answers already fetched: the same search again doesn't ask Nominatim twice. Not shown. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const answers = new Map<string, Place[]>();

	async function search(event: SubmitEvent) {
		event.preventDefault();
		const q = query.trim();
		if (!q || searching) return;
		searching = true;
		searchError = null;
		picked = null;
		try {
			let found = answers.get(q);
			if (!found) {
				// The usage policy's one request per second.
				const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
				if (wait > 0) await new Promise((done) => setTimeout(done, wait));
				lastRequest = Date.now();
				found = await searchAddress(q);
				answers.set(q, found);
			}
			places = found;
			if (found.length === 1) picked = found[0];
		} catch {
			searchError = 'The search didn’t answer. Check the connection, or enter coordinates instead.';
			places = null;
		} finally {
			searching = false;
		}
	}

	// Coordinates.
	let text = $state('');
	let parsed = $derived(text.trim() ? parseCoordinates(text) : null);

	/** What would be saved, how exact it is, and anything to say about it. */
	interface Candidate {
		position: LatLon;
		uncertaintyM: number;
		bounds?: [number, number, number, number];
		/** Why it's only this exact. */
		reason: string;
		note?: string;
	}

	let candidate = $derived.by((): Candidate | null => {
		if (mode === 'address') {
			if (!picked) return null;
			return {
				position: picked.position,
				uncertaintyM: picked.uncertaintyM,
				bounds: picked.bounds,
				reason:
					picked.matched === 'building'
						? 'the size of the building'
						: picked.matched === 'street'
							? 'OpenStreetMap doesn’t know this house number, so this is just the street'
							: 'only the area matched, not a street or house'
			};
		}
		if (!parsed || 'error' in parsed) return null;
		// The box the rounding allows: half the last digit either way.
		const { lat, lon } = parsed.position;
		const half = parsed.resolutionM / 2 / METRES_PER_DEGREE;
		return {
			position: parsed.position,
			bounds: [lat - half, lat + half, lon - half, lon + half],
			// Rounding: the true value is within half the last digit.
			uncertaintyM: parsed.resolutionM / 2,
			reason: `the last digit given is worth ${distance(parsed.resolutionM)}`,
			note:
				parsed.from === 'centre'
					? 'That link only says where the map was centred, not a marked spot.'
					: undefined
		};
	});

	/** 6 m, 560 m, 5.6 km, 56 km. */
	function distance(m: number): string {
		if (m < 100) return `${Math.max(1, Math.round(m))} m`;
		if (m < 1000) return `${Math.round(m / 10) * 10} m`;
		return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
	}

	const coordinates = (p: LatLon) =>
		`${Math.abs(p.lat).toFixed(5)}° ${p.lat < 0 ? 'S' : 'N'}, ${Math.abs(p.lon).toFixed(5)}° ${p.lon < 0 ? 'W' : 'E'}`;

	const matchLabel = { building: 'Building', street: 'Street only', area: 'Area only' };
</script>

<svelte:head>
	<title>Antenna position · lab1090</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100">
	<header class="flex items-center gap-4 border-b border-zinc-800 px-4 py-3 sm:px-6">
		<img src={logo} alt="lab1090" class="h-8 w-auto" />
		{#if data.position}
			<a href={resolve('/(app)')} class="ml-auto text-sm text-zinc-400 hover:text-white"
				>Back to the map</a
			>
		{/if}
	</header>

	<main class="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
		<div class="space-y-3">
			<h1 class="text-2xl font-semibold">Where is your antenna?</h1>
			<p class="text-zinc-300">
				Aircraft send their own positions, but lab1090 works out everything relative to your
				antenna: distances, the coverage plot, which of the possible positions in a message is the
				right one. It needs the antenna's position to about {GOOD_M} m.
			</p>
			<InfoTip label="Why so exact?" class="text-sm text-zinc-400" wide>
				<p>
					Decoding positions only needs a rough one: ADS-B compresses each position so it fits many
					places on Earth, and the one nearest the receiver is right. They're one CPR zone apart: 6°
					of latitude (about 670 km) for aircraft in the air, 1.5° (about 170 km) on the ground.
				</p>
				<p>
					The coverage plot needs more. It looks up the ground height under the antenna on a terrain
					map and works out at which angle above the horizon each aircraft was heard; a few hundred
					metres off can put the antenna on another slope, and the walls and hills that block it in
					the wrong directions.
				</p>
			</InfoTip>
		</div>

		{#if data.position}
			<p class="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
				Now: <span class="font-mono">{coordinates(data.position)}</span>
				{#if data.fixed}
					<br />Set with <code class="text-zinc-100">--position</code> when lab1090 was started: change
					it there.
				{/if}
			</p>
		{/if}

		{#if !data.fixed}
			<div class="grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 p-1" role="group">
				{#each [['address', 'Search an address'], ['coordinates', 'Enter coordinates']] as const as [value, label] (value)}
					<button
						type="button"
						class={[
							'rounded-md px-3 py-2 text-sm',
							mode === value ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
						]}
						aria-pressed={mode === value}
						onclick={() => (mode = value)}>{label}</button
					>
				{/each}
			</div>

			{#if mode === 'address'}
				<section class="space-y-4">
					<p class="text-sm text-zinc-400">
						Searching sends what you type from this browser to <a
							href="https://nominatim.org"
							class="text-sky-400 hover:text-sky-300">Nominatim</a
						>, OpenStreetMap's address search, run by the OpenStreetMap Foundation (<a
							href="https://osmfoundation.org/wiki/Privacy_Policy"
							class="text-sky-400 hover:text-sky-300">privacy policy</a
						>). The lab1090 server never sees the address, only the position you save. Rather not?
						<button
							type="button"
							class="text-sky-400 hover:text-sky-300"
							onclick={() => (mode = 'coordinates')}>Enter coordinates</button
						> instead.
					</p>
					<form class="flex gap-2" onsubmit={search}>
						<input
							bind:value={query}
							type="search"
							autocomplete="street-address"
							placeholder="Street and number, town"
							aria-label="Address"
							class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none"
						/>
						<button
							type="submit"
							disabled={searching || !query.trim()}
							class="shrink-0 rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
							>{searching ? 'Searching…' : 'Search'}</button
						>
					</form>
					{#if searchError}
						<p class="text-sm text-red-300">{searchError}</p>
					{:else if places?.length === 0}
						<p class="text-sm text-zinc-400">
							Nothing found. Try the street and town without extras, or enter coordinates.
						</p>
					{:else if places?.length}
						<ul class="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
							{#each places as place (place.name + place.position.lat)}
								<li>
									<button
										type="button"
										class={[
											'flex w-full items-start gap-3 px-4 py-3 text-left text-sm',
											picked === place ? 'bg-zinc-800' : 'hover:bg-zinc-900'
										]}
										aria-pressed={picked === place}
										onclick={() => (picked = place)}
									>
										<span class="min-w-0 flex-1 text-zinc-200">{place.name}</span>
										<span
											class={[
												'shrink-0 text-xs',
												place.matched === 'building' ? 'text-zinc-400' : 'text-amber-300'
											]}>{matchLabel[place.matched]}</span
										>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					{#if places?.length}
						<p class="text-xs text-zinc-500">
							Search by Nominatim · data © <a
								href="https://www.openstreetmap.org/copyright"
								class="hover:text-zinc-300">OpenStreetMap contributors</a
							>
						</p>
					{/if}
				</section>
			{:else}
				<section class="space-y-3">
					<input
						bind:value={text}
						type="text"
						inputmode="text"
						autocomplete="off"
						spellcheck="false"
						placeholder="52.5163, 13.3777 or a map link"
						aria-label="Coordinates or a map link"
						class="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono placeholder:font-sans placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none"
					/>
					{#if parsed && 'error' in parsed}
						<p class="text-sm text-red-300">{parsed.error}</p>
					{/if}
					<div class="space-y-1 text-sm text-zinc-400">
						<p>Latitude first, then longitude. Where to find them:</p>
						<ul class="list-disc space-y-1 pl-5">
							<li>
								Google Maps: right-click the spot (on a phone: touch and hold it). The coordinates
								are the menu's first line (on a phone: in the search box).
							</li>
							<li>
								OpenStreetMap: right-click the spot, “Show address”: they appear in the search box.
							</li>
							<li>Or share the spot from your phone's map app and paste the link.</li>
						</ul>
					</div>
				</section>
			{/if}

			{#if candidate}
				{@const tooCoarse = candidate.uncertaintyM > MAX_M}
				<section class="space-y-3">
					<PositionMap position={candidate.position} bounds={candidate.bounds} />
					<p class="text-sm text-zinc-300">
						<span class="font-mono">{coordinates(candidate.position)}</span>
						{#if candidate.uncertaintyM <= GOOD_M}
							<span class="text-zinc-400">
								· within about {distance(candidate.uncertaintyM)}. Is the marker on your building?</span
							>
						{/if}
					</p>
					{#if candidate.note}
						<p class="text-sm text-amber-300">
							{candidate.note} Check that the marker is on your building.
						</p>
					{/if}
					{#if candidate.uncertaintyM > GOOD_M}
						<p
							class={[
								'rounded-lg border px-4 py-3 text-sm',
								tooCoarse
									? 'border-red-900/60 bg-red-950/40 text-red-200'
									: 'border-amber-900/60 bg-amber-950/40 text-amber-200'
							]}
						>
							{tooCoarse ? 'Too rough to use' : 'Only rough'}: up to {distance(
								candidate.uncertaintyM
							)}
							off, since {candidate.reason}. Distances and the coverage would be off by as much.
							{mode === 'address'
								? 'Try with the house number, or enter coordinates.'
								: 'Use more decimals: four give a few metres.'}
						</p>
					{/if}
					<form method="POST">
						<input type="hidden" name="lat" value={candidate.position.lat} />
						<input type="hidden" name="lon" value={candidate.position.lon} />
						<button
							type="submit"
							disabled={tooCoarse}
							class="w-full rounded-md bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500 sm:w-auto"
							>Use this position</button
						>
					</form>
				</section>
			{/if}

			{#if form?.error}
				<p class="text-sm text-red-300">{form.error}</p>
			{/if}

			<p class="text-xs text-zinc-500">
				Saved on the lab1090 server, in <span class="font-mono break-all">{data.configPath}</span>.
				{#if !data.position}To correct it later, open the receiver's panel on the map.{/if}
			</p>
		{/if}
	</main>
</div>
