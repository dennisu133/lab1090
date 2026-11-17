<!--
	The worked example's third card: whether engines leave a contrail in this observation's
	air (Schmidt–Appleman, lib/weather/contrail.ts), with its own numbers and the diagram.
	The footer says what the tracker panel decides for the same aircraft, which may use its
	layer's mean temperature instead (describe/contrail.ts trackerContrail): this card is the
	panel's "why".
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { contrailValue, humidityNeeded, type TrackerContrail } from '#lib/describe/contrail.ts';
	import { celsius, flightLevel } from '#lib/describe/weather.ts';
	import { staticPressure } from '#lib/modes/air-data.ts';
	import {
		CP,
		EI_H2O,
		EPSILON,
		ETA,
		ETA_MODERN,
		Q,
		TEMPERATURE_MARGIN,
		contrailRange,
		saturationOverIce,
		saturationOverWater,
		schumannFit,
		thresholds
	} from '#lib/weather/contrail.ts';
	import type { Observation } from '#lib/weather/observation.ts';
	import ContrailChart from './ContrailChart.svelte';

	let { observation: o, tracker }: { observation: Observation; tracker: TrackerContrail | null } =
		$props();

	/** With a real minus sign, like celsius(). */
	const n = (x: number, digits = 1) => x.toFixed(digits).replace('-', '−');
	const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;

	let feet = $derived(o.inputs.altitude?.feet ?? null);
	let kelvin = $derived(o.temperature?.kelvin ?? null);
	let pressure = $derived(feet === null ? null : staticPressure(feet));
	let r = $derived(kelvin === null || pressure === null ? null : contrailRange(kelvin, pressure));
	let modern = $derived(
		pressure === null || !r
			? 0
			: thresholds(pressure, ETA_MODERN).saturated - r.at.thresholds.saturated
	);
</script>

<div class="h-86 rounded-lg bg-zinc-900 p-4">
	<div class="mb-3 flex items-baseline gap-3 whitespace-nowrap">
		<InfoTip
			heading="h3"
			class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
			label="Contrail"
		>
			<p>
				A contrail is a cloud the engines make. Burning kerosene gives water vapour and heat; behind
				the engine the hot, wet exhaust mixes with the cold air around it. On the way from one to
				the other, temperature and water vapour change in step, so in the diagram the mixture moves
				along a straight line (<span class="text-amber-300">amber</span>). If that line crosses the
				<span class="text-sky-300">water curve</span>, the mixture is supersaturated for a moment:
				droplets form and freeze at once. That's the Schmidt–Appleman criterion (Schmidt 1941,
				Appleman 1953; the form here is Schumann 1996).
			</p>
			<p>
				Air with more water vapour starts higher up, closer to the curve: the more humid, the warmer
				the air can be. The line drawn just touches the curve; any air on or above it gives a
				contrail.
			</p>
			<p class="text-zinc-400">
				Humidity at cruise level is almost never in the data (register 4,4 is rarely sent), so the
				answer is the humidity the air would need. Looking up settles it.
			</p>
		</InfoTip>
		{#if r}
			<span class={['text-lg', o.temperatureProblem ? 'text-zinc-500' : 'text-zinc-100']}>
				{contrailValue(r)}
			</span>
		{/if}
		{#if o.temperatureProblem}
			<span
				class="min-w-0 truncate text-sm text-orange-400"
				title="Not used: {o.temperatureProblem}"
			>
				temperature not used: {o.temperatureProblem}
			</span>
		{/if}
	</div>

	{#if r && kelvin !== null && pressure !== null && feet !== null}
		{@const t = r.at.thresholds}
		{@const eLM = saturationOverWater(t.saturated)}
		{@const eT = saturationOverWater(kelvin)}
		<div class="flex flex-col gap-4 sm:flex-row">
			<ContrailChart {kelvin} result={r.at} />
			<ol class="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
				<li>
					<strong>Pressure</strong>: {flightLevel(feet)} is wherever the pressure is {n(
						pressure / 100
					)} hPa (pressure altitude).
				</li>
				<li>
					<span class="text-amber-300">The engine's line</span> has the slope
					<InfoTip label="G = EI · cₚ · p / (ε · Q · (1 − η))">
						<p>
							How much water vapour the exhaust carries for each kelvin of heat it brings. EI = {EI_H2O}
							kg of water per kg of kerosene burnt; Q = {Q / 1e6} MJ/kg, the heat in it; cₚ = {CP} J/(kg·K),
							what it takes to warm air; ε = {EPSILON}, water's molar mass over air's (vapour
							pressure from the mixing ratio); p, the pressure.
						</p>
						<p>
							η = {ETA}: the share of the heat that goes into pushing the aircraft instead of
							warming the plume, typical for engines of the 1990s (Schumann 2000). A modern engine
							reaches about {ETA_MODERN}: a cooler, steeper line, and contrails in air {n(modern)} K warmer
							here. We can't tell the engine, so one value for all.
						</p>
					</InfoTip>
					= {EI_H2O} × {CP} × {Math.round(pressure).toLocaleString('en')} / ({EPSILON} × {Q.toLocaleString(
						'en'
					)} × {n(1 - ETA)}) = <strong>{n(t.slope, 2)} Pa/K</strong>.
				</li>
				<li>
					<strong>Saturated air</strong> (100 %): the line touches the water curve where the curve
					is as steep,
					<InfoTip label="at {celsius(t.saturated)}">
						<p>
							Solved numerically from the slope of the saturation curve (Sonntag 1994): {n(eLM)} Pa at
							that temperature. Schumann's fitted formula gives {celsius(schumannFit(t.slope))}.
						</p>
						<p class="text-zinc-400">
							Warmer than this, no contrail however humid the air: the line can't reach the curve.
						</p>
					</InfoTip>
					(upper dot).
				</li>
				<li>
					<strong>Dry air</strong> (0 %): down the line to no vapour at all: {n(
						t.saturated - 273.15
					)} − {n(eLM)} Pa / {n(t.slope, 2)} Pa/K = <strong>{celsius(t.dry)}</strong> (lower dot).
				</li>
				<li>
					<strong>This air</strong>, {celsius(kelvin)} (Temperature, above):
					{#if r.at.verdict === 'always'}
						colder than the dry-air limit: <strong>a contrail in any air</strong>.
					{:else if r.at.verdict === 'never'}
						warmer than the saturated-air limit: <strong>no contrail</strong>, however humid.
					{:else}
						it needs ({n(eLM)} − {n(t.slope, 2)} × {n(t.saturated - kelvin)}) / {n(eT)} Pa =
						<strong>{pct(r.at.humidityNeeded!)}</strong> relative humidity, where the bar turns
						<span class="text-sky-300">blue</span>.
					{/if}
				</li>
				<li class="text-zinc-400">
					<InfoTip label="± {TEMPERATURE_MARGIN} K">
						<p>
							The temperature is a couple of kelvin off: the rounding alone (Temperature, above),
							and against weather balloons aircraft read 2 K too cold on average, one 7 K. Near the
							limits 1 K changes the humidity needed by about 20 points, so a firm yes or no needs
							to hold {TEMPERATURE_MARGIN} K either way (the shaded stripe).
						</p>
					</InfoTip>:
					{#if humidityNeeded(r) === null}
						too warm either way.
					{:else}
						needs {humidityNeeded(r)} at {celsius(kelvin - TEMPERATURE_MARGIN)} to {celsius(
							kelvin + TEMPERATURE_MARGIN
						)}.
					{/if}
				</li>
				<li class="text-zinc-400">
					<InfoTip label="Lasting">
						<p>
							A contrail's ice crystals survive only where the air is saturated over ice. Ice holds
							on to its molecules more firmly than water, so that comes earlier: here at {n(
								saturationOverIce(kelvin)
							)} of {n(eT)} Pa (the white tick). Drier, the trail vanishes within seconds; wetter, it
							stays and can spread into cirrus. Whether the air is that humid isn't in the data.
						</p>
					</InfoTip>
					only above {pct(r.at.iceSaturation)} humidity (white tick).
				</li>
			</ol>
		</div>
	{:else if o.temperature}
		<p class="text-sm text-zinc-500">No altitude for this pair: the pressure is unknown.</p>
	{/if}

	{#if tracker}
		<p class="mt-2 truncate text-xs text-zinc-500">
			The tracker's panel uses {tracker.layer
				? `${flightLevel(tracker.layer.level)}'s mean, ${celsius(tracker.kelvin)} from ${tracker.layer.aircraft} aircraft`
				: `its own reading, ${celsius(tracker.kelvin)}`}, and says “{contrailValue(tracker.range)}”.
		</p>
	{/if}
</div>
