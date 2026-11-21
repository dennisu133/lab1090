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
	import { celsius, fixed as n, levelOrFeet, n as whole } from '#lib/describe/format.ts';
	import { staticPressure } from '#lib/modes/air-data.ts';
	import {
		CP,
		EI_H2O,
		EPSILON,
		ETA,
		ETA_OLDER,
		Q,
		TEMPERATURE_MARGIN,
		contrailRange,
		olderEngineShift,
		saturationOverIce,
		saturationOverWater,
		schumannFit
	} from '#lib/weather/contrail.ts';
	import type { Observation } from '#lib/weather/observation.ts';
	import ContrailChart from './ContrailChart.svelte';
	import Card from './Card.svelte';

	let { observation: o, tracker }: { observation: Observation; tracker: TrackerContrail | null } =
		$props();

	/** With a real minus sign, like celsius(). */
	const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;

	let feet = $derived(o.inputs.altitude?.feet ?? null);
	let kelvin = $derived(o.temperature?.kelvin ?? null);
	let pressure = $derived(feet === null ? null : staticPressure(feet));
	let r = $derived(kelvin === null || pressure === null ? null : contrailRange(kelvin, pressure));
	let older = $derived(pressure === null ? 0 : olderEngineShift(pressure));
</script>

<!-- What the tracker's panel says for this aircraft: at the bottom, under the steps. -->
{#snippet trackerLine(className: string)}
	{#if tracker}
		<p class={[className, 'truncate text-xs text-zinc-500']}>
			The tracker's panel uses {tracker.layer
				? `${levelOrFeet(tracker.layer.level)}'s mean, ${celsius(tracker.kelvin)} from ${tracker.layer.aircraft} aircraft`
				: `its own reading, ${celsius(tracker.kelvin)}`}, and says “{contrailValue(tracker.range)}”.
		</p>
	{/if}
{/snippet}

<Card title="Contrail" class="min-h-76.5" nowrap>
	{#snippet info()}
		<p>
			A contrail is a cloud the engines make. Burning kerosene gives water vapour and heat; behind
			the engine the hot, wet exhaust mixes with the cold air around it. On the way from one to the
			other, temperature and water vapour change in step, so in the diagram the mixture moves along
			a straight line (<span class="text-amber-300">amber</span>). If that line crosses the
			<span class="text-blue-300">water curve</span>, the mixture is supersaturated for a moment:
			droplets form and freeze at once. That's the
			<a
				href="https://elib.dlr.de/32128/"
				target="_blank"
				rel="noreferrer"
				class="text-accent-400 hover:text-accent-300">Schmidt–Appleman criterion</a
			> (Schmidt 1941, Appleman 1953; the form here is Schumann 1996).
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
		<p class="text-zinc-400">Worked out from the temperature above: greyed out along with it.</p>
	{/snippet}
	{#snippet header()}
		{#if r}
			<span class={['text-sm', o.temperatureProblem ? 'text-zinc-500' : 'text-zinc-100']}>
				{contrailValue(r)}
			</span>
		{/if}
		<!-- Why there's no temperature is on the temperature card. -->
		{#if !o.temperature}
			<span class="text-sm text-warn-400">no temperature</span>
		{/if}
	{/snippet}

	{#if r && kelvin !== null && pressure !== null && feet !== null}
		{@const t = r.at.thresholds}
		{@const eLM = saturationOverWater(t.saturated)}
		{@const eT = saturationOverWater(kelvin)}
		<div class="flex flex-col gap-4 sm:flex-row">
			<ContrailChart {kelvin} result={r.at} />
			<div class="flex min-w-0 flex-col">
				<ol class="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
					<li>
						<strong>Pressure</strong>: {levelOrFeet(feet)} is wherever the pressure is {n(
							pressure / 100
						)} hPa (pressure altitude).
					</li>
					<li>
						<span class="text-amber-300">The engine's line</span> has the slope
						<InfoTip>
							{#snippet label()}
								<math>
									<mi>G</mi><mo>=</mo>
									<mfrac displaystyle="true">
										<mrow>
											<mi>EI</mi><mo>·</mo><msub><mi>c</mi><mi>p</mi></msub>
											<mo>·</mo><mi>p</mi>
										</mrow>
										<mrow>
											<mi>ε</mi><mo>·</mo><mi>Q</mi><mo>·</mo><mo stretchy="false">(</mo>
											<mn>1</mn><mo>−</mo><mi>η</mi><mo stretchy="false">)</mo>
										</mrow>
									</mfrac>
								</math>
							{/snippet}
							<p>
								How much water vapour the exhaust carries for each kelvin of heat it brings.
								<math><mi>EI</mi><mo>=</mo><mn>{EI_H2O}</mn></math> kg of water per kg of kerosene
								burnt;
								<math>
									<mi>Q</mi><mo>=</mo><mn>{Q / 1e6}</mn><mspace width="0.25em" />
									<mfrac displaystyle="true"><mtext>MJ</mtext><mtext>kg</mtext></mfrac>
								</math>, the heat in it;
								<math>
									<msub><mi>c</mi><mi>p</mi></msub><mo>=</mo><mn>{CP}</mn><mspace width="0.25em" />
									<mfrac displaystyle="true">
										<mtext>J</mtext>
										<mrow><mtext>kg</mtext><mo>·</mo><mtext>K</mtext></mrow>
									</mfrac>
								</math>, what it takes to warm air;
								<math><mi>ε</mi><mo>=</mo><mn>{EPSILON}</mn></math>, how much lighter a water
								molecule is than the average air molecule (18 against 29 g/mol);
								<math><mi>p</mi></math>, the pressure.
							</p>
							<p>
								<math><mi>η</mi><mo>=</mo><mn>{ETA}</mn></math>: the share of the fuel's heat that
								pushes the aircraft instead of warming the exhaust, typical of today's airliners.
								Which engines an aircraft has isn't in the data, so all get the same value.
							</p>
							<p class="text-zinc-400">
								Older engines were less efficient: about {ETA_OLDER} was measured on an Airbus A340 in
								the 1990s (<a
									href="https://elib.dlr.de/9281/"
									target="_blank"
									rel="noreferrer"
									class="text-accent-400 hover:text-accent-300">Schumann et al. 2000</a
								>). Their warmer exhaust needed air {n(older)} K colder here to leave a contrail.
							</p>
						</InfoTip>
						=
						<math>
							<mfrac displaystyle="true">
								<mrow>
									<mn>{EI_H2O}</mn><mo>×</mo><mn>{CP}</mn><mo>×</mo><mn>{whole(pressure)}</mn>
								</mrow>
								<mrow>
									<mn>{EPSILON}</mn><mo>×</mo><mn>{whole(Q)}</mn><mo>×</mo><mn>{n(1 - ETA)}</mn>
								</mrow>
							</mfrac>
						</math>
						= <strong>{n(t.slope, 2)} Pa/K</strong>.
					</li>
					<li>
						<strong>Saturated air</strong> (100 %): the line touches the water curve where the curve
						is as steep,
						<InfoTip label="at {celsius(t.saturated)}">
							<p>
								Found by searching for the temperature where the water curve (<a
									href="https://doi.org/10.1127/metz/3/1994/51"
									target="_blank"
									rel="noreferrer"
									class="text-accent-400 hover:text-accent-300">Sonntag 1994</a
								>) is exactly as steep as the line: there, saturated air holds {n(eLM)} Pa of water vapour.
								Schumann's approximate formula gives {celsius(schumannFit(t.slope))}.
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
							<span class="text-blue-300">blue</span>.
						{/if}
					</li>
					<li class="text-zinc-400">
						<InfoTip label="± {TEMPERATURE_MARGIN} K">
							<p>
								The temperature is a couple of kelvin off: the rounding alone (Temperature, above),
								and against weather balloons aircraft read 2 K too cold on average, one 7 K. One
								kelvin can change the humidity needed by about 20 points, or tip the answer to no
								contrail at all. So a firm yes or no needs to hold {TEMPERATURE_MARGIN} K either way (the
								shaded stripe).
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
								A contrail's ice crystals survive only where the air is saturated over ice. Ice
								holds on to its molecules more firmly than water, so that comes earlier: here at {n(
									saturationOverIce(kelvin)
								)} of {n(eT)} Pa (the white tick). Drier, the trail vanishes within seconds; wetter, it
								stays and can spread into cirrus. Whether the air is that humid isn't in the data.
							</p>
						</InfoTip>
						only above {pct(r.at.iceSaturation)} humidity (white tick).
					</li>
				</ol>
				{@render trackerLine('mt-auto pt-2')}
			</div>
		</div>
	{:else}
		{#if o.temperature}
			<p class="text-sm text-zinc-500">No altitude for this pair: the pressure is unknown.</p>
		{/if}
		{@render trackerLine('mt-2')}
	{/if}
</Card>
