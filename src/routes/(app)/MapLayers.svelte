<!--
	Switches for what the map draws: the range rings around the receiver, and around the
	aircraft the trails behind them, the predicted paths ahead, the position uncertainty
	circles and the wind barbs where they measured the wind; the antenna's coverage. Below a
	line, two parts of the base map: roads and place names (borders, terrain and airports
	always stay: they're what you find your way by). Below another, the experiments: the
	ground radars. All on by default but the wind barbs (busy hours fill the map with them),
	coverage and the experiments. With the trails off, the selected aircraft still has one.
	Labels whose layer needs explaining are InfoTips (tappable: phones never show `title`);
	Roads and Place names are plain. The rings' unit is set above the aircraft list.

	The "Layers" button at the bottom folds the switches away. Until it's used, they're folded
	on phones (they'd cover a third of the map) and open from `md` on, by CSS so the server's
	page is already right; once used, the choice is remembered.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { flightLevel } from '#lib/describe/format.ts';
	import type { Layers } from '#lib/map/layers.ts';
	import { MediaQuery } from 'svelte/reactivity';
	import LayerSwitch from './LayerSwitch.svelte';
	import { PREDICT_S, PREDICT_SELECTED_S } from '#lib/map/features.ts';
	import { MAX_OPEN_TURN } from '#lib/tracker/motion.ts';
	import { GAP_MS, SLOWER_TOLERANCE, TRACK_TOLERANCE_DEG, TRAIL_MS } from '#lib/tracker/trail.ts';
	import { BARB_BIN_MS, BARB_FADE_MS } from '#lib/map/winds.ts';
	import { BANDS } from '#lib/coverage/coverage.ts';
	import { HORIZON_FT } from '#lib/map/coverage.ts';
	import { MIN_ELLIPSE_KM } from '#lib/radar/finder.ts';
	import { MIN_CORRECTION } from '#lib/weather/headings.ts';

	interface Props {
		layers: Layers;
	}

	let { layers = $bindable() }: Props = $props();

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

<div class="rounded-md border border-zinc-800 bg-zinc-950 text-xs text-zinc-400">
	<div
		id="map-layers"
		class={[
			'space-y-1 border-b border-zinc-800 px-3 pt-2 pb-1.5',
			open === null ? 'hidden md:block' : !open && 'hidden'
		]}
	>
		<LayerSwitch bind:checked={layers.rings} label="Show the range rings" name="Rings">
			{#snippet icon()}
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
			{/snippet}
			<p>
				Circles at equal distances around the receiver. Nautical miles are aviation's unit: one
				minute of latitude, 1,852 m.
			</p>
		</LayerSwitch>
		<LayerSwitch bind:checked={layers.trail} label="Show the trails" name="Trail">
			{#snippet icon()}
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
			{/snippet}
			<p>
				Where each aircraft has been in the last {TRAIL_MS / 60_000} min, in the colour of its altitude.
				After more than {GAP_MS / 1000} s without a position the trail breaks: nobody heard where the
				aircraft went.
			</p>
			<p>
				A fainter line bridges the gap where the aircraft must have flown straight. Its length over
				the gap's time is a speed, and any detour would make it slower than the aircraft flew. So it
				has to be the ground speed the aircraft reported on both sides (at most {SLOWER_TOLERANCE *
					100} % slower), and the line has to point along the track it reported at both ends (within {TRACK_TOLERANCE_DEG}°).
			</p>
		</LayerSwitch>
		<LayerSwitch
			bind:checked={layers.prediction}
			label="Show the predicted paths"
			name="Prediction"
		>
			{#snippet icon()}
				<!-- A dotted line, like on the map (from sm on: on phones the two boxes must fit side by side). -->
				<svg viewBox="0 0 20 6" class="hidden h-1.5 w-5 sm:block" aria-hidden="true">
					{#each [3, 10, 17] as cx (cx)}
						<circle {cx} cy="3" r="1.5" fill="currentColor" />
					{/each}
				</svg>
			{/snippet}
			<p>
				Where each aircraft gets to in the next {PREDICT_S / 60} min ({PREDICT_SELECTED_S / 60} min with
				minute marks when selected) if it keeps doing what it does now: the same ground speed, the turn
				rate measured over the last seconds, climbing or descending to the altitude set on the autopilot.
			</p>
			<p>
				A turn ends at the selected heading if the autopilot steers by heading; following its route
				(LNAV) the end is unknown, so the line stops after {MAX_OPEN_TURN}°. It can't see a turn or
				climb coming before it starts.
			</p>
		</LayerSwitch>
		<LayerSwitch
			bind:checked={layers.uncertainty}
			label="Show the position uncertainty circles"
			name="Uncertainty"
		>
			{#snippet icon()}
				<!-- A filled circle (accuracy) inside a ring (containment), like on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<circle cx="10" cy="6" r="3" fill="currentColor" opacity="0.4" />
					<circle cx="10" cy="6" r="5.25" fill="none" stroke="currentColor" stroke-width="1" />
				</svg>
			{/snippet}
			<p>
				How far off the position may be, as the aircraft states it, to scale. With satellite
				navigation it's tens of metres, hidden under the symbol unless you zoom in close; large
				circles mean no satellites (inertial navigation, radio beacons) or jamming.
			</p>
			<p>
				<strong>Filled: accuracy</strong> (NACp), where the true position is 95 % of the time.
				<strong>Ring: integrity</strong> (NIC), the containment radius air traffic control relies
				on.
				<strong class="text-amber-400">Amber ring</strong>, not to scale: it knows neither (NACp 0,
				NIC 0).
			</p>
		</LayerSwitch>
		<LayerSwitch bind:checked={layers.winds} label="Show the wind barbs" name="Wind">
			{#snippet icon()}
				<!-- A barb lying down, like a west wind on the map: staff, two feathers, a dot. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<g stroke="currentColor" stroke-width="1.25" stroke-linecap="round" fill="none">
						<line x1="17" y1="9" x2="3" y2="9" />
						<line x1="3" y1="9" x2="1.5" y2="2.5" />
						<line x1="6" y1="9" x2="5" y2="5.5" />
					</g>
					<circle cx="17" cy="9" r="1.5" fill="currentColor" />
				</svg>
			{/snippet}
			<p>
				The wind the aircraft measured, where they measured it: one barb per aircraft and {BARB_BIN_MS /
					60_000} min, for the last {BARB_FADE_MS / 60_000} min, fading with age, coloured by altitude.
			</p>
			<p>
				<strong>How to read one:</strong> the staff points from the dot to where the wind comes from.
				The feathers add up to the speed: a long one 10 kt, a short one 5 kt, a triangle (pennant) 50
				kt. They sit on the low-pressure side: in the northern hemisphere, on the right looking along
				the staff from the dot.
			</p>
			<p>
				Nobody sends a wind: it's how the aircraft moves over the ground minus how it moves through
				the air (registers 5,0 and 6,0, which only some radars ask for). A heading clearly off from
				the other aircraft's winds (at least {MIN_CORRECTION}°) is corrected first.
			</p>
		</LayerSwitch>
		<LayerSwitch bind:checked={layers.coverage} label="Show the coverage" name="Coverage">
			{#snippet icon()}
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
			{/snippet}
			<p>
				How far this antenna hears in every direction: one outline per altitude band ({BANDS.map(
					(b) => b.name
				).join(', ')}), out to the farthest position heard in it. The dashed amber circle is the
				radio horizon at {flightLevel(HORIZON_FT)}: how far a line of sight reaches over a smooth
				Earth. An outline well short of it: a building or a hill in the way, or the signal gives out
				first.
			</p>
		</LayerSwitch>
		<LayerSwitch bind:checked={layers.roads} label="Show the roads" name="Roads" divided>
			{#snippet icon()}
				<!-- Two lanes, like a motorway on the map. -->
				<svg viewBox="0 0 20 6" class="hidden h-1.5 w-5 sm:block" aria-hidden="true">
					<g stroke="currentColor" stroke-width="1" stroke-linecap="round">
						<line x1="2" y1="1.5" x2="18" y2="1.5" />
						<line x1="2" y1="4.5" x2="18" y2="4.5" />
					</g>
				</svg>
			{/snippet}
		</LayerSwitch>
		<LayerSwitch bind:checked={layers.places} label="Show the place names" name="Place names">
			{#snippet icon()}
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
			{/snippet}
		</LayerSwitch>
		<p class="border-t border-zinc-800 pt-1.5 text-xs text-warn-300">Experimental</p>
		<LayerSwitch
			bind:checked={layers.radars}
			label="Search for the ground radars and show them"
			name="Radars"
		>
			{#snippet icon()}
				<!-- A radar dish on its mast, like the symbol on the map. -->
				<svg viewBox="0 0 20 12" class="hidden h-3 w-5 sm:block" aria-hidden="true">
					<g stroke="currentColor" stroke-width="1.25" stroke-linecap="round" fill="none">
						<line x1="4" y1="2" x2="16" y2="2" />
						<line x1="10" y1="2" x2="10" y2="11" />
						<line x1="7" y1="11" x2="13" y2="11" />
					</g>
				</svg>
			{/snippet}
			<p>
				The ground radars asking the aircraft we hear, found from the answers alone: we never hear a
				radar itself (it asks on 1030 MHz, we listen on 1090). Each all-call reply names its radar,
				and a turning radar only asks while its beam points at the aircraft: the reply times give
				how fast it turns, and when the beam passed aircraft whose positions we know, where it
				stands.
			</p>
			<p>
				The dashed ellipse: how sure the fit is (at least {MIN_ELLIPSE_KM} km either way); the sweeping
				line: where the beam points now.
			</p>
			<p>
				It costs about a minute of CPU an hour when the sky is busy; switched off, it stops and
				forgets.
			</p>
		</LayerSwitch>
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
				'ml-auto h-1.5 w-2.5 motion-safe:transition-transform',
				open === null ? 'md:rotate-180' : open && 'rotate-180'
			]}
			aria-hidden="true"
		>
			<path d="M1 5 5 1 9 5" fill="none" stroke="currentColor" stroke-width="1.25" />
		</svg>
	</button>
</div>
