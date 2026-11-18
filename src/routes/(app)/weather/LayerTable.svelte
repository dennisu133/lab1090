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

<!-- Fixed layout: only the column temperature wraps. Scrolls only below lg (see /comm-b). -->
<div class="overflow-x-auto">
	<table class="w-full min-w-240 table-fixed text-sm tabular-nums [&_td]:pr-4 [&_th]:pr-4">
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
							The static air temperature at this level, from 5,0's true airspeed and 6,0's Mach, and
							how it compares with the standard atmosphere (ISA).
						</p>
					</InfoTip>
				</th>
				<th class="w-28 py-1 font-normal">
					<InfoTip label="Lapse rate">
						<p>
							How much colder it gets per km up, to the next layer with a temperature. 6.5 K/km in
							the standard troposphere, 0 above the tropopause. ≤ 2 K/km is the WMO's threshold for
							the tropopause.
						</p>
					</InfoTip>
				</th>
				<th class="w-64 py-1 font-normal">
					<InfoTip label="Wind">
						<p>Mean wind (5,0/6,0 and turns), where it blows from, and how steady it is.</p>
					</InfoTip>
				</th>
				<th class="w-32 py-1 font-normal">
					<InfoTip label="GNSS − baro" align="right">
						<p>
							GNSS height minus pressure altitude, as ADS-B sends it (TC 19): how far the real
							height of this pressure level is from the standard atmosphere's, before corrections.
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
				<tr class={['h-9 border-t border-zinc-900', selected === level && 'bg-zinc-900']}>
					<td class="py-0.5 whitespace-nowrap">
						{#if r.layer.column}
							<button
								class={['hover:underline', selected === level && 'text-amber-300']}
								onclick={() => onselect(level)}>{levelOrFeet(level)}</button
							>
						{:else}
							<span>{levelOrFeet(level)}</span>
						{/if}
						{#if tropopause.found && tropopause.level === level}
							<span class="ml-1 text-xs text-amber-300">tropopause</span>
						{/if}
						{#if strongest?.level === level}
							<span class="ml-1 text-xs text-emerald-300">strongest</span>
						{/if}
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
