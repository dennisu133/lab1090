<!--
	Switches for what the map draws: the range rings around the receiver, and around the
	aircraft the trails behind them, the predicted paths ahead, the position uncertainty
	circles and the wind barbs where they measured the wind; the antenna's coverage. Below a
	line, two parts of the base map: roads and place names (borders, terrain and airports
	always stay: they're what you find your way by). Below another, the experiments: the
	ground radars. All on by default but coverage and the experiments. With the trails off,
	the selected aircraft still has one. Each label explains what it shows (tappable: phones
	never show `title`). The rings' row also holds the NM/km switch, which the distances in the
	list and the panel follow too; the radars' row says how far the search has got.

	The "Layers" button at the bottom folds the switches away. Until it's used, they're folded
	on phones (they'd cover a third of the map) and open from `md` on, by CSS so the server's
	page is already right; once used, the choice is remembered.
-->
<script lang="ts" module>
	export interface Layers {
		rings: boolean;
		trail: boolean;
		prediction: boolean;
		uncertainty: boolean;
		winds: boolean;
		/** How far the antenna hears, per altitude band, and the radio horizon. */
		coverage: boolean;
		/** Experimental: the ground radars found from the replies. Off: not searched for. */
		radars: boolean;
		/** Base map: motorways, trunk and primary roads. */
		roads: boolean;
		/** Base map: city and town names. */
		places: boolean;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { PREDICT_S, PREDICT_SELECTED_S, type Unit } from '#lib/map/features.ts';
	import { MAX_OPEN_TURN } from '#lib/tracker/motion.ts';
	import { GAP_MS, STEP_MS, TRAIL_MS } from '#lib/tracker/trail.ts';
	import { BARB_BIN_MS, BARB_FADE_MS } from '#lib/map/winds.ts';
	import { BANDS, OPEN_DEG } from '#lib/coverage/coverage.ts';
	import { HORIZON_FT } from '#lib/map/coverage.ts';
	import { CONFIRM_MS, MIN_ELLIPSE_KM } from '#lib/radar/finder.ts';
	import { MIN_CORRECTION } from '#lib/weather/headings.ts';
	import type { RadarStream } from './radar-stream.svelte';

	interface Props {
		layers: Layers;
		/** Distances: the rings' labels, the list and the panel. */
		unit: Unit;
		/** Is the receiver's position known? Without it there are no rings or coverage. */
		receiver: boolean;
		/** The radar search: how far it has got, next to its switch. */
		radars: RadarStream;
	}

	let { layers = $bindable(), unit = $bindable(), receiver, radars }: Props = $props();

	/** Open or folded: null until the button is used (then it's by screen width, see above). */
	const OPEN_KEY = 'tracker.layersOpen';
	let open = $state<boolean | null>(null);
	/** Tailwind's `md`, where the switches start open. */
	const wide = new MediaQuery('min-width: 48rem');
	let shown = $derived(open ?? wide.current);
	onMount(() => {
		const saved = localStorage.getItem(OPEN_KEY);
		if (saved === 'open' || saved === 'folded') open = saved === 'open';
	});

	function toggle() {
		open = !shown;
		localStorage.setItem(OPEN_KEY, open ? 'open' : 'folded');
	}
</script>

<div class="rounded-md bg-zinc-950/80 text-xs text-zinc-400 backdrop-blur">
	<div
		id="map-layers"
		class={[
			'space-y-1 border-b border-zinc-800 px-3 pt-2 pb-1.5',
			open === null ? 'hidden md:block' : !open && 'hidden'
		]}
	>
		<div class="flex items-center gap-2">
			<label class={['flex items-center gap-2 py-0.5', receiver ? 'cursor-pointer' : 'opacity-50']}>
				<input
					type="checkbox"
					bind:checked={layers.rings}
					disabled={!receiver}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the range rings"
				/>
				<!-- A dashed circle, like on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<circle
						cx="10"
						cy="6"
						r="5"
						fill="none"
						stroke="currentColor"
						stroke-width="1"
						stroke-dasharray="2 2"
					/>
				</svg>
			</label>
			<InfoTip label="Rings" above>
				<p>
					Dashed circles around the receiver (the white dot) at equal distances, like on a radar
					screen: how far away the aircraft are. Tap the dot for how far the antenna reaches.
					Nautical miles are aviation's unit: one minute of latitude, 1,852 m.
				</p>
				<p>
					NM / km, next to this label: the unit of the rings and of the distances in the list and
					the panel. Altitudes stay in feet, aviation's unit almost everywhere.
				</p>
				{#if !receiver}
					<p>
						No receiver position set: set <code>RECEIVER_POSITION="lat,lon"</code> in
						<code>.env</code> to draw them.
					</p>
				{/if}
			</InfoTip>
			<div class="ml-auto flex" role="group" aria-label="Distance unit">
				{#each ['NM', 'km'] as const as u (u)}
					<button
						type="button"
						onclick={() => (unit = u)}
						aria-pressed={unit === u}
						class={[
							'rounded px-1.5 py-0.5',
							unit === u ? 'bg-zinc-700 text-zinc-100' : 'hover:bg-zinc-800'
						]}>{u}</button
					>
				{/each}
			</div>
		</div>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.trail}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the trails"
				/>
				<!-- A solid line, like on the map. -->
				<svg viewBox="0 0 20 6" class="hidden h-1.5 w-5 sm:block" aria-hidden="true">
					<line
						x1="2"
						y1="3"
						x2="18"
						y2="3"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			</label>
			<InfoTip label="Trail" above>
				<p>
					The line behind each aircraft: where it has been in the last {TRAIL_MS / 60_000} min, a point
					every {STEP_MS / 1000} s, coloured by the altitude it had there, so a climb or descent shows
					as a change of colour. A gap means nothing was received for over {GAP_MS / 1000} s (out of reach,
					or behind a hill).
				</p>
				<p>
					Switched off, only the selected aircraft keeps its trail: handy when many are on screen.
				</p>
			</InfoTip>
		</div>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.prediction}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the predicted paths"
				/>
				<!-- A dotted line, like on the map (from sm on: on phones the two boxes must fit side by side). -->
				<svg viewBox="0 0 20 6" class="hidden h-1.5 w-5 sm:block" aria-hidden="true">
					{#each [3, 10, 17] as cx (cx)}
						<circle {cx} cy="3" r="1.5" fill="currentColor" />
					{/each}
				</svg>
			</label>
			<InfoTip label="Prediction" above>
				<p>
					The dotted line ahead of each aircraft: where it gets to in the next {PREDICT_S / 60} min if
					it keeps doing what it does now ({PREDICT_SELECTED_S / 60} min with minute marks for the selected
					one), coloured by the altitude it will have there. Radar screens in air traffic control draw
					the same, straight, as a "speed vector".
				</p>
				<p>
					It keeps the ground speed, turns at the rate it's turning now, and climbs or descends
					until the altitude set on the autopilot. A turn ends at the selected heading if the
					autopilot steers by heading; following its route (LNAV), the end is unknown, so the line
					stops after
					{MAX_OPEN_TURN}°. It can't see a turn or climb coming before it starts.
				</p>
			</InfoTip>
		</div>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.uncertainty}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the position uncertainty circles"
				/>
				<!-- A filled circle (accuracy) inside a ring (containment), like on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<circle cx="10" cy="6" r="3" fill="currentColor" opacity="0.4" />
					<circle cx="10" cy="6" r="5.25" fill="none" stroke="currentColor" stroke-width="1" />
				</svg>
			</label>
			<InfoTip label="Uncertainty" above>
				<p>
					How far off the position may be, as the aircraft states it, to scale. With satellite
					navigation working, it's tens of metres: hidden under the symbol unless you zoom in close.
					Large circles mean it navigates without satellites (inertial navigation, radio beacons),
					or its receiver is disturbed, e.g. by jamming.
				</p>
				<p>
					<strong>Filled: accuracy</strong> (NACp). The true position is inside it 95 % of the time: what
					the navigation system estimates its own error to be.
				</p>
				<p>
					<strong>Ring: integrity</strong> (NIC, the radius of containment). The position is guaranteed
					to be inside, unless the system fails without noticing, which is what SIL says the odds of (e.g.
					1 in 10 million per hour). Air traffic control separates aircraft relying on this one, so it's
					larger than the accuracy.
				</p>
				<p>
					<strong class="text-amber-400">Amber ring</strong>, not to scale: the aircraft says it
					knows neither (NACp 0, NIC 0). Its position may be anywhere from fine to far off.
				</p>
			</InfoTip>
		</div>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.winds}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the wind barbs"
				/>
				<!-- A barb lying down, like a west wind on the map: staff, two feathers, a dot. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<g stroke="currentColor" stroke-width="1.25" stroke-linecap="round" fill="none">
						<line x1="17" y1="9" x2="3" y2="9" />
						<line x1="3" y1="9" x2="1.5" y2="2.5" />
						<line x1="6" y1="9" x2="5" y2="5.5" />
					</g>
					<circle cx="17" cy="9" r="1.5" fill="currentColor" />
				</svg>
			</label>
			<InfoTip label="Wind" above>
				<p>
					The wind the aircraft measured, drawn where they were when they measured it: one barb per
					aircraft and {BARB_BIN_MS / 60_000} min (the mean of its readings), for the last {BARB_FADE_MS /
						60_000} min, fading with age. Coloured by altitude like the trails: the wind at FL350 can
					differ from the one at FL390 over the same spot. Tap one for the numbers.
				</p>
				<p>
					<strong>How to read one</strong>, as on any weather chart: the staff points from the dot
					towards where the wind comes from. The feathers at its end add up to the speed, in steps
					of 5 kt: a long feather is 10 kt, a short one 5 kt, a filled triangle (pennant) 50 kt. Two
					long and a short one: 25 kt. They sit on the side of the lower pressure: in the northern
					hemisphere, the right-hand side looking along the staff from the dot.
				</p>
				<p>
					Nobody sends a wind. It comes from the wind triangle: how the aircraft moves over the
					ground minus how it moves through the air (its airspeed along its heading). Both are in
					registers 5,0 and 6,0, which only some radars ask for (Enhanced Surveillance): aircraft
					that aren't asked get no barbs. A heading clearly off from what the other aircraft's winds
					say (at least {MIN_CORRECTION}°) is corrected first, as on /weather.
				</p>
				<p>Collected here in the browser, so a reload starts with none.</p>
			</InfoTip>
		</div>
		<div class="flex items-center gap-2">
			<label class={['flex items-center gap-2 py-0.5', receiver ? 'cursor-pointer' : 'opacity-50']}>
				<input
					type="checkbox"
					bind:checked={layers.coverage}
					disabled={!receiver}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the coverage"
				/>
				<!-- A jagged outline around a dot, like the coverage on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<path
						d="M10 1 13 3.5 17.5 4 15 7 16 11 10 9.5 5 11 4.5 7.5 2 5 7 3.5Z"
						fill="none"
						stroke="currentColor"
						stroke-width="1"
						stroke-linejoin="round"
					/>
					<circle cx="10" cy="6.5" r="1.25" fill="currentColor" />
				</svg>
			</label>
			<InfoTip label="Coverage" above>
				<p>
					How far this antenna hears, in every direction: one outline per altitude band ({BANDS.map(
						(b) => b.name
					).join(', ')}), coloured by altitude like the trails, out to the farthest position heard
					in that band. The dashed amber circle is the radio horizon at FL{HORIZON_FT / 100}: how
					far a line of sight reaches to an aircraft that high over a smooth Earth. Where an outline
					stops well short of it, a building or a hill is in the way, or the signal gives out first.
				</p>
				<p>
					<strong>Tap the receiver</strong> (the white dot) for the antenna's sky: in each
					direction, how low above the horizon aircraft are heard. Heard down to a few degrees
					(within {OPEN_DEG}°) means open; a wall hides everything below its own angle, near or far.
				</p>
				<p>
					Collected here in the browser from the moment the page opened, also while it's switched
					off: a direction stays empty until an aircraft has flown there. A reload starts with the
					server's last 10 minutes.
				</p>
				{#if !receiver}
					<p>
						No receiver position set: set <code>RECEIVER_POSITION="lat,lon"</code> in
						<code>.env</code>: coverage is measured from there.
					</p>
				{/if}
			</InfoTip>
		</div>
		<div class="flex items-center gap-2 border-t border-zinc-800 pt-1.5">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.roads}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the roads"
				/>
				<!-- Two lanes, like a motorway on the map. -->
				<svg viewBox="0 0 20 6" class="hidden h-1.5 w-5 sm:block" aria-hidden="true">
					<g stroke="currentColor" stroke-width="1" stroke-linecap="round">
						<line x1="2" y1="1.5" x2="18" y2="1.5" />
						<line x1="2" y1="4.5" x2="18" y2="4.5" />
					</g>
				</svg>
			</label>
			<InfoTip label="Roads" above>
				<p>
					Motorways, and trunk and primary roads from zoom 8 on: the base map's, from OpenStreetMap.
					Only there to find your way around. Airliners don't follow roads, though pilots flying by
					sight (VFR) do use motorways, railways and rivers as landmarks.
				</p>
				<p>
					Country borders, the terrain shading and the airports (with their ICAO codes, e.g. EDDB)
					always stay.
				</p>
			</InfoTip>
		</div>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.places}
					class="size-3.5 accent-zinc-300"
					aria-label="Show the place names"
				/>
				<!-- A letter, like a label on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<text
						x="10"
						y="10"
						text-anchor="middle"
						font-size="11"
						font-weight="600"
						fill="currentColor">Aa</text
					>
				</svg>
			</label>
			<InfoTip label="Place names" above>
				<p>
					The names of cities and towns, from OpenStreetMap: bigger cities first where names compete
					for room. Switched off, the map gets quieter and the aircraft and airport labels are left.
				</p>
				<p>Country names stay with the borders.</p>
			</InfoTip>
		</div>
		<p
			class="border-t border-zinc-800 pt-1.5 text-[10px] tracking-wide text-amber-300/80 uppercase"
		>
			Experimental
		</p>
		<div class="flex items-center gap-2">
			<label class="flex cursor-pointer items-center gap-2 py-0.5">
				<input
					type="checkbox"
					bind:checked={layers.radars}
					class="size-3.5 accent-zinc-300"
					aria-label="Search for the ground radars and show them"
				/>
				<!-- A radar dish on its mast, like the symbol on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<g stroke="currentColor" stroke-width="1.25" stroke-linecap="round" fill="none">
						<line x1="4" y1="2" x2="16" y2="2" />
						<line x1="10" y1="2" x2="10" y2="11" />
						<line x1="7" y1="11" x2="13" y2="11" />
					</g>
				</svg>
			</label>
			<InfoTip label="Radars" above>
				<p>
					The ground radars that ask the aircraft we hear for their altitude and identity, found
					from the answers alone: the antenna never hears a radar itself (radars ask on 1030 MHz, we
					listen on 1090). Each all-call reply names the radar it answers, and a turning radar only
					asks while its beam points at the aircraft. So its replies come once per turn: their times
					give how fast it turns, and the moments the beam passed aircraft whose positions we know
					give where it stands. Tap one for every step, with its own numbers.
				</p>
				<p>
					<strong>Experimental.</strong> Checked against radar sites mapped on OpenStreetMap, the
					radars it shows lie 1–35 km from one, the far ones (500 km and more) furthest off; a few
					have no mapped site nearby. The dashed ellipse is how sure the fit is, at least {MIN_ELLIPSE_KM}
					km either way; the line sweeping round is where the fit says the beam points now.
				</p>
				<p>
					Starts when switched on: a radar shows after a few minutes (once every fit has found it
					for {CONFIRM_MS / 60_000} minutes). It costs more of your computer's time than everything else
					together, about a minute an hour when the sky is busy. Switched off, it stops and forgets what
					it found.
				</p>
				<p>
					The number next to it: the radars shown, + the candidates still being checked, with a
					question mark.
				</p>
			</InfoTip>
			{#if radars.started !== null}
				<span class="ml-auto pl-2 text-zinc-500 tabular-nums">
					{radars.radars.length}{#if radars.candidates.length}&thinsp;+&thinsp;{radars.candidates
							.length}?{/if}
				</span>
			{/if}
		</div>
	</div>
	<button
		type="button"
		onclick={toggle}
		aria-expanded={shown}
		aria-controls="map-layers"
		class="flex w-full items-center gap-2 px-3 py-1.5 hover:text-zinc-200"
	>
		<!-- Stacked sheets: the usual sign for map layers. -->
		<svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
			<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round">
				<path d="M8 2 14 5.25 8 8.5 2 5.25Z" />
				<path d="M2 8.25 8 11.5 14 8.25" />
				<path d="M2 11.25 8 14.5 14 11.25" />
			</g>
		</svg>
		Layers
		<!-- Points up while folded (the switches open upwards), down while open. -->
		<svg
			viewBox="0 0 10 6"
			class={[
				'ml-auto h-1.5 w-2.5 transition-transform',
				open === null ? 'md:rotate-180' : open && 'rotate-180'
			]}
			aria-hidden="true"
		>
			<path d="M1 5 5 1 9 5" fill="none" stroke="currentColor" stroke-width="1.25" />
		</svg>
	</button>
</div>
