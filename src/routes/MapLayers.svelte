<!--
	Switches for what the map draws: the range rings around the receiver, and around the
	aircraft the trails behind them, the predicted paths ahead, the position uncertainty
	circles and the wind barbs where they measured the wind. All on by default. With the trails off, the selected aircraft still has one. Each
	label explains what it shows (tappable: phones never show `title`). The rings' row also
	holds the NM/km switch, which the distances in the list and the panel follow too.
-->
<script lang="ts" module>
	export interface Layers {
		rings: boolean;
		trail: boolean;
		prediction: boolean;
		uncertainty: boolean;
		winds: boolean;
	}
</script>

<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { PREDICT_S, PREDICT_SELECTED_S, type Unit } from '#lib/map/features.ts';
	import { MAX_OPEN_TURN } from '#lib/tracker/motion.ts';
	import { GAP_MS, STEP_MS, TRAIL_MS } from '#lib/tracker/trail.ts';
	import { BARB_BIN_MS, BARB_FADE_MS } from '#lib/map/winds.ts';
	import { MIN_CORRECTION } from '#lib/weather/headings.ts';

	interface Props {
		layers: Layers;
		/** Distances: the rings' labels, the list and the panel. */
		unit: Unit;
		/** Is the receiver's position known? Without it there are no rings to draw. */
		receiver: boolean;
	}

	let { layers = $bindable(), unit = $bindable(), receiver }: Props = $props();
</script>

<div class="space-y-1 rounded-md bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
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
				screen: how far away the aircraft are, and how far the antenna reaches. Nautical miles are
				aviation's unit: one minute of latitude, 1,852 m.
			</p>
			<p>
				NM / km, next to this label: the unit of the rings and of the distances in the list and the
				panel. Altitudes stay in feet, aviation's unit almost everywhere.
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
				every {STEP_MS / 1000} s, coloured by the altitude it had there, so a climb or descent shows as
				a change of colour. A gap means nothing was received for over {GAP_MS / 1000} s (out of reach,
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
				The dotted line ahead of each aircraft: where it gets to in the next {PREDICT_S / 60} min if it
				keeps doing what it does now ({PREDICT_SELECTED_S / 60} min with minute marks for the selected
				one), coloured by the altitude it will have there. Radar screens in air traffic control draw the
				same, straight, as a "speed vector".
			</p>
			<p>
				It keeps the ground speed, turns at the rate it's turning now, and climbs or descends until
				the altitude set on the autopilot. A turn ends at the selected heading if the autopilot
				steers by heading; following its route (LNAV), the end is unknown, so the line stops after
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
				Large circles mean it navigates without satellites (inertial navigation, radio beacons), or
				its receiver is disturbed, e.g. by jamming.
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
				<strong class="text-amber-400">Amber ring</strong>, not to scale: the aircraft says it knows
				neither (NACp 0, NIC 0). Its position may be anywhere from fine to far off.
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
					60_000} min, fading with age. Coloured by altitude like the trails: the wind at FL350 can differ
				from the one at FL390 over the same spot. Tap one for the numbers.
			</p>
			<p>
				<strong>How to read one</strong>, as on any weather chart: the staff points from the dot
				towards where the wind comes from. The feathers at its end add up to the speed, in steps of
				5 kt: a long feather is 10 kt, a short one 5 kt, a filled triangle (pennant) 50 kt. Two long
				and a short one: 25 kt. They sit on the side of the lower pressure: in the northern
				hemisphere, the right-hand side looking along the staff from the dot.
			</p>
			<p>
				Nobody sends a wind. It comes from the wind triangle: how the aircraft moves over the ground
				minus how it moves through the air (its airspeed along its heading). Both are in registers
				5,0 and 6,0, which only some radars ask for (Enhanced Surveillance): aircraft that aren't
				asked get no barbs. A heading clearly off from what the other aircraft's winds say (at least {MIN_CORRECTION}°)
				is corrected first, as on /weather.
			</p>
			<p>Collected here in the browser, so a reload starts with none.</p>
		</InfoTip>
	</div>
</div>
