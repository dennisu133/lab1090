<!--
	Every 1,000 ft layer with data, highest first (like the sky above): temperature, lapse
	rate, wind, GNSS − baro and the column temperature. Click a layer with GNSS − baro to
	work it through below.
-->
<script lang="ts">
	import Fields from '#lib/components/Fields.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		columnDeviationFields,
		lapseField,
		layerColumnFields,
		layerTemperatureFields,
		layerWindFields
	} from '#lib/describe/sky.ts';
	import { levelOrFeet, n } from '#lib/describe/format.ts';
	import type { Column } from '#lib/weather/column.ts';
	import {
		LAYER_FT,
		lapseRate,
		type Layer,
		type StrongestWind,
		type Tropopause
	} from '#lib/weather/profile.ts';

	interface Props {
		layers: Layer[];
		/** column() of each layer, same order as `layers`. */
		columns: (Column | null)[];
		tropopause: Tropopause;
		strongest: StrongestWind | null;
		selected: number | null;
		onselect: (level: number) => void;
	}

	let { layers, columns, tropopause, strongest, selected, onselect }: Props = $props();

	/** Highest first, each with the next layer up that has a temperature (for the lapse rate). */
	let rows = $derived(
		layers
			.map((layer, i) => {
				const above = layers.slice(i + 1).find((l) => l.temperature);
				const t = layer.temperature;
				const upper = above?.temperature ? { level: above.level, ...above.temperature } : null;
				return {
					layer,
					column: columns[i],
					lower: t ? { level: layer.level, ...t } : null,
					upper,
					lapse: t && upper ? lapseRate({ level: layer.level, kelvin: t.kelvin }, upper) : null
				};
			})
			.reverse()
	);
</script>

<!-- Fixed layout: only the column temperature wraps. Scrolls only below lg (see /comm-b). The
     widths fit the widest values at 1024 px: "17,000 ft" with its tags, a 3-digit wind
     speed, counts like 234/9. -->
<div class="overflow-x-auto">
	<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-3 [&_th]:pr-3">
		<thead class="text-left text-xs text-zinc-500">
			<tr>
				<th class="w-36 py-1 font-normal">
					<InfoTip label="Layer">
						<p>
							{n(LAYER_FT)} ft of pressure altitude, centred on the level shown (FL350: 34,500–35,500
							ft). Transponders always report pressure altitude against 1013.25 hPa, whatever the pilots
							set.
						</p>
					</InfoTip>
				</th>
				<th class="w-56 py-1 font-normal">
					<InfoTip label="Temperature">
						<p>
							The air temperature at this level, from 5,0's true airspeed and 6,0's Mach (worked
							through on the Aircraft tab), and how it compares with the standard atmosphere (ISA).
						</p>
					</InfoTip>
				</th>
				<th class="w-24 py-1 font-normal">
					<InfoTip label="Lapse rate">
						<p>
							How much colder it gets per km up, to the next layer with a temperature: 6.5 K/km in
							the standard atmosphere below the tropopause, 0 above it. 2 K/km or less is the WMO's
							threshold for the tropopause.
						</p>
					</InfoTip>
				</th>
				<th class="w-63 py-1 font-normal">
					<InfoTip label="Wind">
						<p>
							The mean wind, where it blows from and how fast, from 5,0/6,0 pairs and from turns;
							then how steady it is.
						</p>
					</InfoTip>
				</th>
				<th class="w-35 py-1 font-normal">
					<InfoTip label="GNSS − baro" align="right">
						<p>
							Satellite (GNSS) height minus pressure altitude, as ADS-B sends it (TC 19): how far
							the real height of this pressure level is from the standard atmosphere's, before the
							corrections in the column card below.
						</p>
					</InfoTip>
				</th>
				<th class="py-1 font-normal">
					<InfoTip label="Column below" align="right">
						<p>
							The mean temperature of all the air below, compared with standard, worked out from
							GNSS − baro. Not the temperature here: in winter it includes the cold air near the
							ground.
						</p>
					</InfoTip>
				</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.layer.level)}
				{@const level = r.layer.level}
				{@const isTropopause = tropopause.found && tropopause.level === level}
				{@const isStrongest = strongest?.level === level}
				<tr class={['h-9 border-t border-zinc-900', selected === level && 'bg-zinc-900']}>
					<td class="py-0.5 whitespace-nowrap">
						<div class="flex items-center gap-1.5">
							{#if r.layer.column}
								<button
									class={['hover:underline', selected === level && 'text-highlight-300']}
									onclick={() => onselect(level)}>{levelOrFeet(level)}</button
								>
							{:else}
								<span>{levelOrFeet(level)}</span>
							{/if}
							<!-- Stacked, so both fit next to "17,000 ft" in the row's height. -->
							{#if isTropopause || isStrongest}
								<span class="flex flex-col text-xs leading-3.5">
									{#if isTropopause}<span class="text-amber-300">tropopause</span>{/if}
									{#if isStrongest}<span class="text-green-300">strongest</span>{/if}
								</span>
							{/if}
						</div>
					</td>
					<td class="py-0.5"><Fields fields={layerTemperatureFields(r.layer)} /></td>
					<td class="py-0.5">
						{#if r.lower}
							<Fields fields={lapseField(r.lower, r.upper, r.lapse)} />
						{:else}
							<span class="text-xs text-zinc-500">—</span>
						{/if}
					</td>
					<td class="py-0.5"><Fields fields={layerWindFields(r.layer)} /></td>
					<td class="py-0.5"><Fields fields={layerColumnFields(r.layer, r.column)} /></td>
					<td class="py-0.5"><Fields fields={columnDeviationFields(r.column)} /></td>
				</tr>
			{:else}
				<tr>
					<td colspan="6" class="py-4 text-zinc-500">Waiting for the first samples…</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
