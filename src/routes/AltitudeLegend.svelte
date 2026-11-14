<!-- What the colours on the map mean: altitude, from the ground up to FL400. -->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { altitudeGradient, GROUND_COLOUR } from '#lib/map/altitude.ts';
</script>

<div class="rounded-md bg-zinc-950/80 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
	<div class="mb-1">
		<InfoTip label="Altitude">
			<p>
				Aircraft and trails are coloured by barometric altitude: warm near the ground (taking off,
				landing), cool at cruising level. A climbing aircraft leaves a trail that changes colour.
			</p>
			<p>
				Grey: on the ground. White: no altitude known yet. Faded: no new position for 10 s (it's
				drawn where it was expected to be).
			</p>
		</InfoTip>
	</div>
	<div class="flex items-center gap-2">
		<span class="size-2.5 rounded-full" style:background-color={GROUND_COLOUR}></span>
		<div class="w-40">
			<div class="h-2 rounded-full" style:background-image={altitudeGradient()}></div>
			<div class="mt-0.5 flex justify-between tabular-nums">
				<span>0</span><span>10k</span><span>20k</span><span>30k</span><span>40k ft</span>
			</div>
		</div>
	</div>
</div>
