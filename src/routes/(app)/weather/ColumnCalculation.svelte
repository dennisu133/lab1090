<!--
	One layer's GNSS − baro worked through to the temperature of the air column below it
	(lib/weather/column.ts), step by step with its own numbers, so it can be checked with a
	calculator. The switch says what the GNSS heights are measured from.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import Segmented from '#lib/components/Segmented.svelte';
	import { FT } from '#lib/units.ts';
	import { celsius, hpa, levelOrFeet, n, signed } from '#lib/describe/format.ts';
	import { isaText } from '#lib/describe/weather.ts';
	import { R_OVER_G_FT, type Column, type HeightReference } from '#lib/weather/column.ts';
	import type { Layer } from '#lib/weather/profile.ts';
	import type { Qnh } from '#lib/weather/sky.ts';
	import Card from './Card.svelte';

	interface Props {
		layer: Layer;
		column: Column;
		qnh: Qnh;
		heights: HeightReference;
	}

	let { layer, column: c, qnh, heights = $bindable() }: Props = $props();

	let col = $derived(layer.column!);
	const ft = (x: number) => `${n(x)} ft`;
	const sft = (x: number) => `${signed(x, 0)} ft`;

	const REFERENCES: { value: HeightReference; label: string }[] = [
		{ value: 'ellipsoid', label: 'above the ellipsoid' },
		{ value: 'sea level', label: 'above sea level' }
	];
</script>

<Card title="The column below {levelOrFeet(layer.level)}" wide>
	{#snippet info()}
		<p>
			Pressure altitude is a pressure turned into a height with the standard atmosphere. It's only a
			real height if the column of air below is standard. If it isn't, the pressure level the
			aircraft flies on sits higher or lower, and the GNSS height shows by how much.
		</p>
		<p>
			Two things move it: the <strong>pressure at the bottom</strong> (high pressure lifts every
			level, about 27 ft per hPa) and the <strong>temperature of the column</strong>: warm air takes
			more room, cold air less. With the first from the pilots' QNH, what's left is the temperature.
		</p>
		<p>
			How much room is the hypsometric equation:
			<math>
				<mi>Δz</mi><mo>=</mo>
				<mfrac displaystyle="true"><mi>R</mi><mi>g</mi></mfrac>
				<mo>·</mo><mi>T</mi><mo>·</mo><mi>ln</mi>
				<mfrac displaystyle="true">
					<msub><mi>p</mi><mn>1</mn></msub>
					<msub><mi>p</mi><mn>2</mn></msub>
				</mfrac>
			</math>, the height <math><mi>Δz</mi></math> between two pressures
			<math><msub><mi>p</mi><mn>1</mn></msub></math> and
			<math><msub><mi>p</mi><mn>2</mn></msub></math>, for air of mean temperature
			<math><mi>T</mi></math> (<math><mi>R</mi></math>: air's gas constant,
			<math><mi>g</mi></math>: gravity).
		</p>
		<p class="text-zinc-400">
			It's the same reason altimeters over-read in the cold, and why approach charts list
			corrections for cold days: the aircraft is lower than the altimeter says.
		</p>
	{/snippet}
	{#snippet header()}
		<span class="text-sm">{isaText(c.isaDeviation)}</span>
		<span class="text-sm text-zinc-500">
			mean of {col.n} samples from {col.aircraft} aircraft
		</span>
	{/snippet}

	<ol class="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
		<li>
			<strong>What the aircraft send.</strong> GNSS height − pressure altitude =
			{sft(col.gnssMinusBaro)} at {ft(col.altitude)} (ADS-B TC 19, in 25 ft steps), so the GNSS height
			is {ft(c.gnssHeight)}.
		</li>
		<li>
			<strong>To sea level.</strong> The GNSS heights are
			<Segmented options={REFERENCES} bind:value={heights} inline />
			<InfoTip label="Which?" wide>
				<p>
					GPS measures from the <strong>WGS84 ellipsoid</strong>, a smooth model of the Earth's
					shape. <strong>Sea level</strong> (the geoid, EGM96) bulges above or sags below it where gravity
					is stronger or weaker: around Berlin it's about 40 m (130 ft) above the ellipsoid.
				</p>
				<p>
					ICAO Doc 9871 has ADS-B send the height above the ellipsoid where the aircraft has it,
					else above sea level, and doesn't say which one a message carries. In a test recording the
					aircraft agree with weather balloons only as above the ellipsoid (within 1 ft on average,
					against 137 ft too high as sea level). Switching changes about {Math.round(
						col.geoid / FT
					)} ft here, worth {(col.geoid / FT / c.feetPerKelvin).toFixed(1)} K.
				</p>
			</InfoTip>
			{#if heights === 'ellipsoid'}
				Subtracting the geoid ({col.geoid.toFixed(1)} m = {ft(col.geoid / FT)} on average where the aircraft
				were) leaves {ft(c.seaLevelHeight)} above sea level.
			{:else}
				So no correction: {ft(c.seaLevelHeight)}.
			{/if}
		</li>
		<li>
			<strong>To geopotential height</strong>, what the standard atmosphere's heights mean (gravity
			weakens with height, so the same climb takes less work up there):
			<math>
				<mi>H</mi><mo>=</mo>
				<mfrac displaystyle="true">
					<mrow><mi>r</mi><mo>·</mo><mi>z</mi></mrow>
					<mrow><mi>r</mi><mo>+</mo><mi>z</mi></mrow>
				</mfrac>
			</math>
			with
			<a
				href="https://ntrs.nasa.gov/citations/19770009539"
				target="_blank"
				rel="noreferrer"
				class="text-accent-400 hover:text-accent-300"
				><math><mi>r</mi><mo>=</mo><mn>6,356,766</mn></math> m</a
			>
			gives {ft(c.geopotential)}, {ft(c.seaLevelHeight - c.geopotential)} less.
		</li>
		<li>
			<strong>The offset</strong>: {ft(c.geopotential)} − {ft(col.altitude)} =
			<span class="text-amber-300">{sft(c.offset)}</span>. That's how much {c.offset >= 0
				? 'higher'
				: 'lower'} the pressure level is than the standard atmosphere puts it.
		</li>
		<li>
			<strong>The pressure part.</strong> QNH {hpa(qnh.hPa)} ({qnh.local.length
				? `median of ${qnh.local.length} aircraft`
				: 'assumed standard: no aircraft reported a local setting'}) is at a pressure altitude of
			{ft(-c.pressurePart)}, which lifts every level by {sft(c.pressurePart)}.
		</li>
		<li>
			<strong>The temperature part</strong> is the rest: {sft(c.offset)} − ({sft(c.pressurePart)}) =
			{sft(c.temperaturePart)}.
		</li>
		<li>
			<strong>Per kelvin</strong>, a column 1 K warmer is
			<math>
				<mfrac displaystyle="true"><mi>R</mi><mi>g</mi></mfrac>
				<mo>·</mo><mi>ln</mi>
				<mfrac displaystyle="true"><mi>QNH</mi><mi>p</mi></mfrac>
			</math>
			thicker:
			<math>
				<mn>{R_OVER_G_FT.toFixed(2)}</mn><mspace width="0.25em" /><mtext>ft</mtext><mo>×</mo>
				<mi>ln</mi>
				<mfrac displaystyle="true">
					<mn>{qnh.hPa.toFixed(2)}</mn>
					<mn>{(c.pressure / 100).toFixed(1)}</mn>
				</mfrac>
			</math>
			= {c.feetPerKelvin.toFixed(1)} ft.
		</li>
		<li>
			<strong>Column temperature</strong>:
			<math>
				<mfrac displaystyle="true">
					<mrow
						><mn>{signed(c.temperaturePart, 0)}</mn><mspace width="0.25em" /><mtext>ft</mtext></mrow
					>
					<mrow>
						<mn>{c.feetPerKelvin.toFixed(1)}</mn><mspace width="0.25em" />
						<mfrac><mtext>ft</mtext><mtext>K</mtext></mfrac>
					</mrow>
				</mfrac>
			</math>
			= <span class="text-amber-300">{signed(c.isaDeviation)} K</span>: the air from the ground up
			to here is on average {Math.abs(c.isaDeviation).toFixed(1)} K {c.isaDeviation >= 0
				? 'warmer'
				: 'colder'} than standard.
			{#if layer.temperature}
				The air <em>at</em>
				{levelOrFeet(layer.level)} itself is {celsius(layer.temperature.kelvin)},
				{isaText(layer.temperature.isaDeviation)} (5,0/6,0){Math.sign(
					layer.temperature.isaDeviation
				) !== Math.sign(c.isaDeviation)
					? ': warmer than standard up here, colder below, or the other way round. Both can be true.'
					: '.'}
			{/if}
		</li>
	</ol>

	<p class="mt-3 text-xs text-zinc-500">
		Simplified: dry air, the ground at sea level, and the column wherever the aircraft were rather
		than straight down. Each hPa of QNH error is about 27 ft, {(27 / c.feetPerKelvin).toFixed(2)} K here.
	</p>
</Card>
