<!--
	One observation's wind worked through step by step, with its own numbers and the wind
	triangle drawn to scale. Everything here can be checked with a calculator.

	Fixed height, so the page below doesn't jump as observations come in: the drawing
	(240 px) plus header and footer, and the steps never get taller than the drawing. The
	header is one line, whatever happens: the reason a value isn't used goes there and is cut
	off if it doesn't fit (the whole text is in its title), so nothing below moves.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { interval, levelOrFeet, signed } from '#lib/describe/format.ts';
	import { acrossText, alongText, driftText, windText } from '#lib/describe/weather.ts';
	import { compass } from '#lib/geo.ts';
	import { MAX_ROLL, MAX_SKEW_MS, STEP, type Observation } from '#lib/weather/observation.ts';
	import { WMM_VALID } from '#lib/weather/wmm.ts';
	import Card from './Card.svelte';
	import WindTriangle from './WindTriangle.svelte';

	let { observation: o }: { observation: Observation } = $props();

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

<Card title="Wind" class="h-86" nowrap>
	{#snippet info()}
		<p>
			The aircraft moves through the air (<span class="text-sky-300">air vector</span>: true
			airspeed, in the direction the nose points), and the air moves over the ground (the
			<span class="text-emerald-300">wind</span>). Together they make the path over the ground (<span
				class="text-amber-300">ground vector</span
			>: ground speed along the track).
		</p>
		<p>
			So <strong>wind = ground − air</strong>. The ground vector comes from GPS, often blended with
			the inertial reference system; the air vector from the pitot tube (true airspeed) and the
			inertial reference system (heading). Mostly separate sensors, so their difference is the wind,
			but an error in the heading goes straight into it.
		</p>
		<p class="text-zinc-400">
			Directions are true (geographic north), clockwise. The wind is given where it blows
			<em>from</em>, as in any weather report.
		</p>
	{/snippet}
	{#snippet header()}
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
	{/snippet}

	{#if o.wind}
		{@const w = o.wind}
		<div class="flex flex-col gap-4 sm:flex-row">
			<WindTriangle result={w} />
			<ol class="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
				<li>
					<strong>True heading.</strong> 6,0 says the nose points to {n(heading.heading!)}°
					<em>magnetic</em>. The declination at
					<InfoTip label={position.from === 'ADS-B' ? 'the aircraft' : 'the receiver'}>
						<p>
							{latLon(position)}: {position.from === 'ADS-B'
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
							<strong>headwind</strong>: it makes the ground speed differ from the airspeed, and so
							the flight time. The part across is the <strong>crosswind</strong>: it pushes the
							aircraft sideways, so the nose has to point a little into the wind to stay on track.
							The angle between nose and track is the
							<strong>drift</strong>.
						</p>
						<p class="text-zinc-400">
							Pilots do this for every runway (each aircraft type has a crosswind limit for landing)
							and for every leg of a flight plan.
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
							and heading to {n(STEP.angle, 3)}° (90/512). Recomputing with every input at both ends
							of its step (16 combinations) gives the range the true wind can be in.
						</p>
						<p class="text-zinc-400">
							This is the part we can calculate. On top come errors we can't see: the aircraft's own
							magnetic variation table (avionics databases are updated rarely), compass calibration,
							and how stale each register is when the radar reads it.
						</p>
					</InfoTip>
					allows {n(w.speedRange[0])}–{n(w.speedRange[1])} kt, ±{n(w.directionSpread)}°.
				</li>
			</ol>
		</div>
	{/if}

	<p class="mt-2 truncate text-xs text-zinc-500">
		<span class={o.skewMs > MAX_SKEW_MS ? 'text-orange-400' : ''}>
			5,0 and 6,0 {interval(o.skewMs)} apart (at most {MAX_SKEW_MS / 1000} s)</span
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
			· {levelOrFeet(o.inputs.altitude.feet)}
		{/if}
	</p>
</Card>
