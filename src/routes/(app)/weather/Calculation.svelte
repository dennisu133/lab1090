<!--
	One observation worked through step by step, with its own numbers: the wind triangle
	(with a drawing), the temperature, and whether engines leave a contrail in that air.
	Everything here can be checked with a calculator.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import {
		acrossText,
		alongText,
		celsius,
		driftText,
		flightLevel,
		isaText,
		signed,
		windText
	} from '#lib/describe/weather.ts';
	import { compass } from '#lib/geo.ts';
	import { A0, RHO0, T0 } from '#lib/modes/air-data.ts';
	import { MAX_ROLL, MAX_SKEW_MS, STEP, type Observation } from '#lib/weather/observation.ts';
	import { WMM_VALID } from '#lib/weather/wmm.ts';
	import type { TrackerContrail } from '#lib/describe/contrail.ts';
	import ContrailCalculation from './ContrailCalculation.svelte';
	import IsaChart from './IsaChart.svelte';
	import WindTriangle from './WindTriangle.svelte';

	interface Props {
		observation: Observation;
		/** What the tracker panel decides for the same aircraft (describe/contrail.ts). */
		contrail: TrackerContrail | null;
	}

	let { observation: o, contrail }: Props = $props();

	let track = $derived(o.inputs.trackAndTurn.value);
	let heading = $derived(o.inputs.headingAndSpeed.value);
	let position = $derived(o.inputs.position);

	const n = (x: number, digits = 1) => x.toFixed(digits);
	/** "63.1 kt north" / "12.0 kt south" */
	const ns = (x: number) => `${n(Math.abs(x))} kt ${x >= 0 ? 'north' : 'south'}`;
	const ew = (x: number) => `${n(Math.abs(x))} kt ${x >= 0 ? 'east' : 'west'}`;
	const latLon = (p: { lat: number; lon: number }) =>
		`${n(Math.abs(p.lat), 2)}° ${p.lat >= 0 ? 'N' : 'S'}, ${n(Math.abs(p.lon), 2)}° ${p.lon >= 0 ? 'E' : 'W'}`;
</script>

<!--
	One card under the other, each a drawing with the steps beside it: side by side, the
	steps would be squeezed into a narrow column and the cards would get very tall.
	Fixed heights, so the page below doesn't jump as observations come in: the drawing
	(240 px) plus header and footer, and the steps never get taller than the drawing.
-->
<div class="space-y-4">
	<!-- Wind -->
	<div class="h-86 rounded-lg bg-zinc-900 p-4">
		<!-- One line, whatever happens: the reason a value isn't used goes here and is cut off
		     if it doesn't fit (the whole text is in its title), so nothing below moves. -->
		<div class="mb-3 flex items-baseline gap-3 whitespace-nowrap">
			<InfoTip
				heading="h3"
				class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
				label="Wind"
			>
				<p>
					The aircraft moves through the air (<span class="text-sky-300">air vector</span>: true
					airspeed, in the direction the nose points), and the air moves over the ground (the
					<span class="text-emerald-300">wind</span>). Together they make the path over the ground (<span
						class="text-amber-300">ground vector</span
					>: ground speed along the track).
				</p>
				<p>
					So <strong>wind = ground − air</strong>. The ground vector comes from GPS, often blended
					with the inertial reference system; the air vector from the pitot tube (true airspeed) and
					the inertial reference system (heading). Mostly separate sensors, so their difference is
					the wind, but an error in the heading goes straight into it.
				</p>
				<p class="text-zinc-400">
					Directions are true (geographic north), clockwise. The wind is given where it blows
					<em>from</em>, as in any weather report.
				</p>
			</InfoTip>
			{#if o.wind}
				<span class={['font-mono text-lg', o.windProblem ? 'text-zinc-500' : 'text-zinc-100']}>
					{windText(o.wind.wind)}
				</span>
			{/if}
			{#if o.windProblem}
				<span class="min-w-0 truncate text-sm text-orange-400" title="Not used: {o.windProblem}">
					not used: {o.windProblem}
				</span>
			{/if}
		</div>

		{#if o.wind}
			{@const w = o.wind}
			<div class="flex flex-col gap-4 sm:flex-row">
				<WindTriangle result={w} />
				<ol class="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
					<li>
						<strong>True heading.</strong> 6,0 says the nose points to {n(heading.heading!)}°
						<em>magnetic</em>. The declination at
						<InfoTip label={position?.from === 'ADS-B' ? 'the aircraft' : 'the receiver'}>
							<p>
								{latLon(position!)}: {position?.from === 'ADS-B'
									? "the aircraft's last ADS-B position."
									: 'the receiver: this aircraft sent no ADS-B position. The declination can be up to about a degree off at the edge of the range.'}
							</p>
							<p>
								Declination is where a compass points, relative to true north. It comes from the
								<strong>World Magnetic Model</strong> (WMM2025, NOAA and the British Geological
								Survey, valid {WMM_VALID.from}–{WMM_VALID.to}).
							</p>
							<p class="text-zinc-400">
								Every 1° of heading error is {n(track.tas! * Math.sin(Math.PI / 180), 0)} kt of made-up
								crosswind at this airspeed, which is why it's looked up per aircraft.
							</p>
						</InfoTip>
						is {signed(w.declination, 2)}°, so true heading {n(w.trueHeading)}°.
					</li>
					<li>
						<span class="text-sky-300">Air vector</span>: {track.tas} kt (TAS, 5,0) towards {n(
							w.trueHeading
						)}° = {ns(w.air.north)}, {ew(w.air.east)}.
					</li>
					<li>
						<span class="text-amber-300">Ground vector</span>: {track.groundSpeed} kt towards {n(
							track.track!
						)}° (5,0) = {ns(w.ground.north)}, {ew(w.ground.east)}.
					</li>
					<li>
						<span class="text-emerald-300">Wind</span> = ground − air = {ns(w.wind.vector.north)},
						{ew(w.wind.vector.east)}: {n(w.wind.speed)} kt towards {n(
							(w.wind.direction + 180) % 360
						)}°, so <strong>from {n(w.wind.direction)}° ({compass(w.wind.direction)})</strong>.
					</li>
					<li>
						<InfoTip label="For the aircraft">
							<p>
								The same wind split along the aircraft's heading and across it (dashed in the
								drawing). The part along it is a <strong>tailwind</strong> or
								<strong>headwind</strong>: it makes the ground speed differ from the airspeed, and
								so the flight time. The part across is the <strong>crosswind</strong>: it pushes the
								aircraft sideways, so the nose has to point a little into the wind to stay on track.
								The angle between nose and track is the
								<strong>drift</strong>.
							</p>
							<p class="text-zinc-400">
								Pilots do this for every runway (each aircraft type has a crosswind limit for
								landing) and for every leg of a flight plan.
							</p>
						</InfoTip>: {alongText(w.components.tailwind)}, {acrossText(w.components.crosswind)}, so
						it drifts {driftText(w.components.drift)} (track {n(track.track!)}°, true heading {n(
							w.trueHeading
						)}°).
					</li>
					<li class="text-zinc-400">
						<InfoTip label="Rounding">
							<p>
								Each register value is rounded to a step: ground speed and TAS to {STEP.speed} kt, track
								and heading to {n(STEP.angle, 3)}° (90/512). Recomputing with every input at both
								ends of its step (16 combinations) gives the range the true wind can be in.
							</p>
							<p class="text-zinc-400">
								This is the part we can calculate. On top come errors we can't see: the aircraft's
								own magnetic variation table (avionics databases are updated rarely), compass
								calibration, and how stale each register is when the radar reads it.
							</p>
						</InfoTip>
						allows {n(w.speedRange[0])}–{n(w.speedRange[1])} kt, ±{n(w.directionSpread)}°.
					</li>
				</ol>
			</div>
		{/if}

		<p class="mt-2 truncate text-xs text-zinc-500">
			<span class={o.skewMs > MAX_SKEW_MS ? 'text-orange-400' : ''}>
				5,0 and 6,0 {o.skewMs < 1000 ? `${Math.round(o.skewMs)} ms` : `${n(o.skewMs / 1000)} s`} apart
				(at most {MAX_SKEW_MS / 1000} s)</span
			>
			·
			{#if track.roll !== null}
				<span class={Math.abs(track.roll) > MAX_ROLL ? 'text-orange-400' : ''}>
					banked {n(Math.abs(track.roll))}° (at most {MAX_ROLL}°)
				</span>
			{:else}
				no roll angle{track.trackRate !== null ? `, track rate ${n(track.trackRate, 2)}°/s` : ''}
			{/if}
			{#if o.inputs.altitude}
				· {flightLevel(o.inputs.altitude.feet)}
			{/if}
		</p>
	</div>

	<!-- Temperature -->
	<div class="h-86 rounded-lg bg-zinc-900 p-4">
		<div class="mb-3 flex items-baseline gap-3 whitespace-nowrap">
			<InfoTip
				heading="h3"
				class="text-sm font-semibold tracking-wide text-zinc-400 uppercase"
				label="Temperature"
			>
				<p>
					Mach is the true airspeed divided by the <strong>speed of sound</strong>, and the speed of
					sound depends on one thing only: the air's temperature. (Sound is carried by the moving
					air molecules; warmer molecules move faster.) So TAS and Mach together give the
					temperature away.
				</p>
				<p>
					It works because the aircraft's air data computer did it the other way round: it measured
					the temperature with a probe outside, worked out Mach from the pitot and static pressures,
					and TAS = Mach × speed of sound. 5,0 and 6,0 hand us both results; we undo the last step.
				</p>
			</InfoTip>
			{#if o.temperature}
				<span class={['text-lg', o.temperatureProblem ? 'text-zinc-500' : 'text-zinc-100']}>
					{celsius(o.temperature.kelvin)}
				</span>
			{/if}
			{#if o.temperatureProblem}
				<span
					class="min-w-0 truncate text-sm text-orange-400"
					title="Not used: {o.temperatureProblem}"
				>
					not used: {o.temperatureProblem}
				</span>
			{/if}
		</div>

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
						<strong>Speed of sound</strong> a = TAS / Mach = {track.tas} / {heading.mach!.toFixed(
							3
						)} =
						{n(t.speedOfSound)} kt.
					</li>
					<li>
						<InfoTip label="a = a₀ · √(T / T₀)">
							<p>
								The speed of sound in air is √(γ·R·T): γ = 1.4 (how air's pressure responds to
								compression) and R = 287 J/(kg·K) (air's gas constant) are fixed, so only the
								absolute temperature T changes it.
							</p>
							<p>
								Written relative to the standard sea level (T₀ = {T0} K, 15 °C, where a₀ = {n(
									A0,
									2
								)} kt) it needs no constants at all.
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
									Warm air also makes the altimeter read low (pressure levels are further apart):
									the Now tab turns that into the temperature of the column below.
								</p>
							</InfoTip>
							at {flightLevel(o.inputs.altitude!.feet)}: {celsius(at.isa)} (dashed). This air is
							<span class={at.isaDeviation >= 0 ? 'text-rose-300' : 'text-sky-300'}
								>{n(Math.abs(at.isaDeviation))} °C {at.isaDeviation >= 0
									? 'warmer'
									: 'colder'}</span
							>: <strong>{isaText(at.isaDeviation)}</strong>.
						</li>
					{/if}
					<li>
						<span class="text-amber-300">The probe</span> outside reads more:
						<InfoTip label="TAT = T · (1 + 0.2 M²)">
							<p>
								<strong>Total air temperature.</strong> The air hitting the probe is brought to a stop,
								and its energy of motion turns into heat. 0.2 is (γ − 1)/2 for air, with γ = 1.4.
							</p>
							<p class="text-zinc-400">
								Air data computers work the other way: they measure TAT and calculate the static
								temperature from it and the Mach number.
							</p>
						</InfoTip>
						= {celsius(t.total)} (hollow dot), {n(t.total - t.kelvin, 0)} °C warmer than the air.
					</li>
					{#if at}
						<li>
							<strong>Air density</strong> ρ = p / (R·T) = {Math.round(
								at.pressure
							).toLocaleString()} Pa / (287.05 × {n(t.kelvin)} K) = {at.density.toFixed(3)} kg/m³, {n(
								(at.density / RHO0) * 100,
								0
							)} % of sea level. Standard air is this thin at
							<InfoTip label="{Math.round(at.densityAltitude).toLocaleString()} ft">
								<p>
									The <strong>density altitude</strong>: where the standard atmosphere has this
									density. The pressure p comes from the pressure altitude (that's what it means: FL{Math.round(
										o.inputs.altitude!.feet / 100
									)} is wherever the pressure is {n(at.pressure / 100)} hPa).
								</p>
								<p>
									Wings and engines feel density, not pressure: in warm air they perform as if
									higher up, in cold air as if lower. It matters most on the ground: a hot day at a
									high airport needs a much longer take-off run.
								</p>
							</InfoTip>.
						</li>
					{/if}
					<li class="text-zinc-400">
						<InfoTip label="Rounding">
							<p>
								TAS comes in {STEP.speed} kt steps and Mach in steps of {STEP.mach} (2.048/512). The coldest
								the air can be is with the slowest TAS and the highest Mach in those steps ({(track.tas ??
									0) - 1} kt, {(heading.mach! + STEP.mach / 2).toFixed(3)}), the warmest the other
								way round.
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
	</div>

	<ContrailCalculation observation={o} tracker={contrail} />
</div>
