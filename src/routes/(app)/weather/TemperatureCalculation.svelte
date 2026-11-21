<!--
	One observation's temperature worked through step by step, from TAS and Mach, with its
	own numbers and the standard atmosphere drawn beside it. Everything here can be checked
	with a calculator. Sized like the wind card (see there), without its footer.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		celsius,
		fixed as n,
		flightLevel,
		levelOrFeet,
		n as whole
	} from '#lib/describe/format.ts';
	import { isaText } from '#lib/describe/weather.ts';
	import { A0, R_AIR, RHO0, T0 } from '#lib/modes/air-data.ts';
	import { MAX_SKEW_MS, STEP, type Observation } from '#lib/weather/observation.ts';
	import Card from './Card.svelte';
	import IsaChart from './IsaChart.svelte';

	let { observation: o }: { observation: Observation } = $props();

	let track = $derived(o.inputs.trackAndTurn.value);
	let heading = $derived(o.inputs.headingAndSpeed.value);
</script>

<Card title="Temperature" class="min-h-76.5" nowrap>
	{#snippet info()}
		<p>
			<strong>True airspeed</strong> (TAS) is how fast the aircraft moves through the air around it.
			At cruise height it is much more than what the cockpit's airspeed indicator shows, because the
			air up there is thin{#if track.tas !== null && heading.ias !== null}: this aircraft flies at {track.tas}
				kt true, but its indicator reads {heading.ias} kt{/if}.
		</p>
		<p>
			The <strong>Mach number</strong> is the true airspeed as a fraction of the speed of sound{#if heading.mach !== null}:
				Mach {heading.mach.toFixed(2)} is {n(heading.mach * 100, 0)} % of it{/if}. The speed of
			sound depends only on the air's temperature: sound travels as molecules bump into each other,
			and warmer molecules move faster. So TAS and Mach together give away the temperature.
		</p>
		<p>
			The aircraft measures the temperature with a probe outside, and Mach from air pressures. From
			those two it works out its TAS. 5,0 and 6,0 send TAS and Mach, so that last step can be done
			backwards.
		</p>
		<p>
			Greyed out and left out of the profile if 5,0 and 6,0 are more than {MAX_SKEW_MS / 1000} s apart:
			the speed may have changed in between.
		</p>
	{/snippet}
	{#snippet header()}
		{#if o.temperature}
			<span class={['text-sm', o.temperatureProblem ? 'text-zinc-500' : 'text-zinc-100']}>
				{celsius(o.temperature.kelvin)}
			</span>
		{/if}
		<!-- Only when there's no temperature (an input missing, Mach too small): with one, the
		     only problem left is the pair's timing, shown by the grey and the wind card's checks. -->
		{#if !o.temperature && o.temperatureProblem}
			<span class="min-w-0 truncate text-sm text-warn-400" title={o.temperatureProblem}>
				{o.temperatureProblem}
			</span>
		{/if}
	{/snippet}

	{#if o.temperature}
		{@const t = o.temperature}
		{@const at = t.atAltitude}
		<div class="flex flex-col gap-4 sm:flex-row">
			<IsaChart result={t} altitude={o.inputs.altitude?.feet ?? null} />
			<ol class="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
				<li>
					From 5,0: true airspeed {track.tas} kt. From 6,0: Mach {heading.mach!.toFixed(3)}.
				</li>
				<li>
					<strong>Speed of sound</strong> a = TAS / Mach = {track.tas} / {heading.mach!.toFixed(3)} =
					{n(t.speedOfSound)} kt.
				</li>
				<li>
					<InfoTip>
						{#snippet label()}
							<math>
								<mi>a</mi><mo>=</mo><msub><mi>a</mi><mn>0</mn></msub><mo>·</mo>
								<msqrt><mi>T</mi><mo>/</mo><msub><mi>T</mi><mn>0</mn></msub></msqrt>
							</math>
						{/snippet}
						<p>
							The speed of sound in air is
							<math>
								<mi>a</mi><mo>=</mo>
								<msqrt><mi>γ</mi><mo>·</mo><mi>R</mi><mo>·</mo><mi>T</mi></msqrt>
							</math>:
							<math><mi>γ</mi><mo>=</mo><mn>1.4</mn></math> (how air's pressure responds to
							compression) and
							<math>
								<mi>R</mi><mo>=</mo><mn>287</mn><mspace width="0.25em" />
								<mfrac displaystyle="true">
									<mtext>J</mtext>
									<mrow><mtext>kg</mtext><mo>·</mo><mtext>K</mtext></mrow>
								</mfrac>
							</math>
							(air's gas constant) are fixed, so only the absolute temperature
							<math><mi>T</mi></math> changes it.
						</p>
						<p>
							Written relative to the standard sea level, where
							<math><msub><mi>T</mi><mn>0</mn></msub><mo>=</mo><mn>{T0}</mn></math> K (15 °C) and
							<math><msub><mi>a</mi><mn>0</mn></msub><mo>=</mo><mn>{n(A0, 2)}</mn></math> kt, it needs
							no constants at all.
						</p>
					</InfoTip>, solved for T: T = {T0} K × ({n(t.speedOfSound)} / {n(A0, 2)})² =
					<strong>{n(t.kelvin)} K = {celsius(t.kelvin)}</strong> (white dot).
				</li>
				{#if at}
					<li>
						<InfoTip label="Standard atmosphere">
							<p>
								The <strong>International Standard Atmosphere</strong> (ISA) is an agreed average: 15
								°C at sea level, 1.98 °C colder per 1,000 ft, and −56.5 °C from the tropopause at 36,089
								ft up. Altimeters and performance charts are built on it.
							</p>
							<p>
								Real air is rarely exactly standard, so temperatures aloft are often given as the
								difference: "ISA +10" is 10 °C warmer than standard.
							</p>
							<p class="text-zinc-400">
								Warm air also makes the altimeter read low (pressure levels are further apart): the
								Profile tab turns that into the temperature of the column below.
							</p>
						</InfoTip>
						at {levelOrFeet(o.inputs.altitude!.feet)}: {celsius(at.isa)} (dashed). This air is
						<span class={at.isaDeviation >= 0 ? 'text-red-300' : 'text-blue-300'}
							>{n(Math.abs(at.isaDeviation))} °C {at.isaDeviation >= 0 ? 'warmer' : 'colder'}</span
						>: <strong>{isaText(at.isaDeviation)}</strong>.
					</li>
				{/if}
				<li>
					<span class="text-amber-300">The probe</span> outside reads warmer:
					<InfoTip>
						{#snippet label()}
							<math>
								<mi>TAT</mi><mo>=</mo><mi>T</mi><mo>·</mo>
								<mo stretchy="false">(</mo><mn>1</mn><mo>+</mo>
								<mn>0.2</mn><msup><mi>M</mi><mn>2</mn></msup>
								<mo stretchy="false">)</mo>
							</math>
						{/snippet}
						<p>
							<strong>TAT, the total air temperature,</strong> is what the temperature probe on the
							outside of the aircraft measures. The air hitting the probe is brought almost to a
							stop, and its energy of motion turns into heat. So the probe reads warmer than the air
							around it, the more so the faster the aircraft flies: at airliner cruise speeds by
							about <span class="whitespace-nowrap">25–30 °C</span>.
						</p>
						<p class="text-zinc-400">
							The 0.2 comes from a property of air:
							<math>
								<mfrac displaystyle="true">
									<mrow><mi>γ</mi><mo>−</mo><mn>1</mn></mrow>
									<mn>2</mn>
								</mfrac>
							</math>
							with <math><mi>γ</mi><mo>=</mo><mn>1.4</mn></math>. The aircraft does this sum the
							other way round: it measures TAT, and calculates the real air temperature from it and
							the Mach number.
						</p>
					</InfoTip>
					= {celsius(t.total)} (hollow dot), {n(t.total - t.kelvin, 0)} °C warmer than the air.
				</li>
				{#if at}
					<li>
						<strong>Air density</strong> ρ = p / (R·T) = {whole(at.pressure)} Pa / ({R_AIR} × {n(
							t.kelvin
						)} K) = {at.density.toFixed(3)} kg/m³, {n((at.density / RHO0) * 100, 0)} % of sea level. Standard
						air is this thin at
						<InfoTip label="{whole(at.densityAltitude)} ft">
							<p>
								The <strong>density altitude</strong>: where the standard atmosphere has this
								density. The pressure p comes from the pressure altitude (that's what it means: {flightLevel(
									o.inputs.altitude!.feet
								)} is wherever the pressure is {n(at.pressure / 100)} hPa).
							</p>
							<p>
								Wings and engines feel density, not pressure: in warm air they perform as if higher
								up, in cold air as if lower. It matters most on the ground: a hot day at a high
								airport needs a much longer take-off run.
							</p>
						</InfoTip>.
					</li>
				{/if}
				<li class="text-zinc-400">
					<InfoTip label="Rounding">
						<p>
							TAS comes in {STEP.speed} kt steps and Mach in steps of {STEP.mach} (2.048/512). The coldest
							the air can be is with the slowest TAS and the highest Mach in those steps ({track.tas! -
								STEP.speed / 2} kt, {(heading.mach! + STEP.mach / 2).toFixed(3)}), the warmest the
							other way round.
						</p>
						<p class="text-zinc-400">
							That's why one aircraft's temperature jumps by a degree or two between readings: a
							single step in Mach is worth about 2 K at cruise. Averaging over a minute, and over
							several aircraft, smooths it out.
						</p>
					</InfoTip>
					allows {celsius(t.range[0])} to {celsius(t.range[1])}.
				</li>
			</ol>
		</div>
	{/if}
</Card>
