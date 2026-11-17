<!--
	What the colours on the map mean: altitude, from 0 up to FL400. The ramp is only for
	altitudes: "on the ground" and "unknown" aren't points on it (a grey start would make
	aircraft at 500 ft on approach look parked), so their colours are in the explanation.

	The explanation is a key: one dot per colour as the map draws it, from the ground up the
	ramp's ticks (in ft, as flight levels like the list, and in km for scale), then the two
	states that aren't heights (no altitude, faded).

	On phones the title sits beside the bar, not above it: one line less of the short map.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		altitudeCss,
		altitudeGradient,
		ALTITUDE_STOPS,
		GROUND_COLOUR,
		UNKNOWN_COLOUR
	} from '#lib/map/altitude.ts';
	import { flightLevel, STALE_MS, STALE_OPACITY } from '#lib/map/features.ts';

	const FT = 0.3048;
	/** The legend's ticks above 0: every 10,000 ft. */
	const TICKS = [10_000, 20_000, 30_000, 40_000];
	/** The faded sample: an aircraft at cruise level. */
	const CRUISE_FT = 35_000;
	const top = ALTITUDE_STOPS.at(-1)![0];
</script>

<div
	class="flex items-center gap-2.5 rounded-md bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur sm:block sm:py-2"
>
	<div class="sm:mb-1">
		<InfoTip label="Altitude" above>
			<p>
				Aircraft and trails are coloured by barometric altitude: warm near the ground (taking off,
				landing), cool at cruising level.
			</p>
			<table class="text-xs leading-normal whitespace-nowrap tabular-nums">
				<tbody>
					{@render state(GROUND_COLOUR, 'On the ground')}
					{#each TICKS as feet (feet)}
						<tr>
							<td class="pr-2">{@render swatch(altitudeCss(feet))}</td>
							<td class="pr-3 text-right">{feet.toLocaleString('en')} ft</td>
							<td class="pr-3">{flightLevel(feet)}</td>
							<td class="text-right">{((feet * FT) / 1000).toFixed(1)} km</td>
							<td class="w-full"></td>
						</tr>
					{/each}
					{@render state(UNKNOWN_COLOUR, 'No altitude known yet')}
					{@render state(
						altitudeCss(CRUISE_FT),
						`No new position for ${STALE_MS / 1000} s: drawn where expected`,
						STALE_OPACITY
					)}
				</tbody>
			</table>
			<p class="text-xs text-zinc-400">
				km in the standard atmosphere: the real height can be a few hundred metres off.
			</p>
		</InfoTip>
	</div>
	<div class="w-32 sm:w-40">
		<div class="h-2 rounded-full" style:background-image={altitudeGradient()}></div>
		<div class="mt-0.5 flex justify-between tabular-nums">
			<span>0</span>
			{#each TICKS as feet (feet)}
				<span>{feet / 1000}k{feet === top ? ' ft' : ''}</span>
			{/each}
		</div>
	</div>
</div>

{#snippet swatch(colour: string, opacity = 1)}
	<span
		class="inline-block size-2.5 rounded-full align-[-1px]"
		style:background-color={colour}
		style:opacity
	></span>
{/snippet}

<!-- A colour that isn't a height: its text spans the number columns. (The empty last
     column takes the spare width, so the numbers stay together.) -->
{#snippet state(colour: string, text: string, opacity = 1)}
	<tr>
		<td class="pr-2 align-top">{@render swatch(colour, opacity)}</td>
		<td colspan="4" class="whitespace-normal">{text}</td>
	</tr>
{/snippet}
