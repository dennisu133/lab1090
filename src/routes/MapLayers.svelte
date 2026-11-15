<!--
	Switches for what the map draws on top of the aircraft: the predicted paths and the
	position uncertainty circles. Both on by default; off is the classic tracker. Each label
	explains what it shows (tappable: phones never show `title`).
-->
<script lang="ts" module>
	export interface Layers {
		prediction: boolean;
		uncertainty: boolean;
	}
</script>

<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { PREDICT_S, PREDICT_SELECTED_S } from '#lib/map/features.ts';
	import { MAX_OPEN_TURN } from '#lib/tracker/motion.ts';

	let { layers = $bindable() }: { layers: Layers } = $props();
</script>

<div class="space-y-1 rounded-md bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
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
</div>
