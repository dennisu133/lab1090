<!--
	A radar the finder located (lib/radar/finder.ts), and how: every step with this radar's own
	numbers, from the replies that name it to its position and how sure that is. Opens when a
	radar is tapped on the tracker's map (experimental Radars layer). The other radars and the
	codes heard are listed at the end.
-->
<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { ago, directionText, distanceText, fixed, n, type Unit } from '#lib/describe/format.ts';
	import { compass, distanceKm } from '#lib/geo.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { BURST_GAP_MS } from '#lib/radar/bursts.ts';
	import {
		BEAM_FRESH_MS,
		MAX_ELLIPSE_KM,
		MIN_ELLIPSE_KM,
		MIN_AIRCRAFT,
		MIN_BURSTS,
		MIN_PER_AIRCRAFT,
		MIN_SHARE,
		seenFrom,
		shownSpread,
		WINDOW_MS,
		type CodeSummary,
		type Radar
	} from '#lib/radar/finder.ts';
	import { INLIER, OUTLIER } from '#lib/radar/resection.ts';
	import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
	import RadarCodes from './RadarCodes.svelte';
	import RadarList from './RadarList.svelte';
	import PanelHeader from './PanelHeader.svelte';

	interface Props {
		radar: Radar;
		/** Every radar shown and every candidate, for the list at the end. */
		radars: Radar[];
		candidates: Radar[];
		/** Every code heard lately, for the list at the end. */
		codes: CodeSummary[];
		/** The aircraft on the map: callsigns, and which can be opened on the tracker. */
		aircraft: TrackedAircraft[];
		now: number;
		receiver: LatLon;
		unit: Unit;
		onselect: (icao: string) => void;
		onselectradar: (id: string) => void;
		onclose: () => void;
	}

	let {
		radar: r,
		radars,
		candidates,
		codes,
		aircraft,
		now,
		receiver,
		unit,
		onselect,
		onselectradar,
		onclose
	}: Props = $props();

	const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
	const km = (x: number) => distanceText(x, unit);
	const plural = (count: number, word: string) => `${n(count)} ${word}${count === 1 ? '' : 's'}`;

	let seconds = $derived(r.period / 1000);
	let rpm = $derived(60 / seconds);
	let from = $derived(seenFrom(r, receiver));
	let tracked = $derived(new Map(aircraft.map((a) => [a.icao, a])));
	let heard = $derived(now - r.heard <= BEAM_FRESH_MS);
	let others = $derived(codes.filter((c) => c.code !== r.code));
	let shown = $derived(shownSpread(r));

	// Chart 1: the gaps between each aircraft's bursts, 0.25 s bins up to 32 s.
	const GAP_MAX = 32;
	const GAP_BIN = 0.25;
	let gapBins = $derived.by(() => {
		const bins = new Array<number>(GAP_MAX / GAP_BIN).fill(0);
		for (const g of r.gaps) if (g < GAP_MAX) bins[Math.floor(g / GAP_BIN)]++;
		return bins;
	});
	let gapTop = $derived(Math.max(1, ...gapBins));

	// Chart 2: each burst's miss, 1° bins from −20° to 20°; the rest counted beyond.
	const MISS_MAX = 20;
	let missBins = $derived.by(() => {
		const bins = new Array<number>(2 * MISS_MAX).fill(0);
		for (const m of r.residuals) if (Math.abs(m) < MISS_MAX) bins[Math.floor(m + MISS_MAX)]++;
		return bins;
	});
	let missTop = $derived(Math.max(1, ...missBins));
	let beyond = $derived(r.residuals.filter((m) => Math.abs(m) >= MISS_MAX).length);

	// The jackknife: how far the fit moves without each aircraft.
	let moves = $derived(
		r.spread.without
			.map((w) => ({ icao: w.icao, km: distanceKm(r.position, w.position) }))
			.sort((a, b) => b.km - a.km)
	);

	/** The chart's size: viewBox units. */
	const W = 360;
	const H = 72;
	const AXIS = 14;
</script>

<PanelHeader {onclose}>
	<h2 class="text-xl font-semibold">
		Radar <span class="font-mono">{r.id}</span>
		<span class="text-sm font-normal text-warn-300">experimental</span>
	</h2>
	<p class="text-sm text-zinc-400">
		{fixed(rpm, 1)} rpm · {r.clockwise ? 'clockwise' : 'anticlockwise'}
		· {km(from.km)}
		{compass(from.bearing)} of the receiver
	</p>
</PanelHeader>

<div class="space-y-3 px-4 pb-3 text-sm text-zinc-300">
	<p>
		Nobody told us this radar is here, and the antenna never heard it: radars ask on 1030 MHz, we
		listen on 1090. It was found from the answers of {r.codeAircraft} aircraft, in four steps.
	</p>
	<p class="text-zinc-400">Take the symbol as "somewhere in the ellipse", not as the spot.</p>
	{#if r.sharing.length}
		<p class="text-zinc-400">
			It shares its code with {r.sharing.join(', ')}: radars whose coverage overlaps may use the
			same code if they form a cluster, which coordinates them through a ground network. Each turns
			on its own, so each explains its own bursts; this one was fitted to what the other{r.sharing
				.length > 1
				? 's'
				: ''} left.
		</p>
	{/if}
</div>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="1 · Who asked">
		<p>
			A Mode S radar finds new aircraft with an "all-call": a question to everyone in its beam. Each
			aircraft answers with a DF11 reply: its address, and a checksum (CRC) with the code of the
			radar that asked mixed into it. Checking the CRC leaves that code instead of zero.
		</p>
		<p>
			II (1–15) and SI (1–63) codes are assigned so that radars whose coverage overlaps have
			different ones, so a code is close to a name. II 0 is left out: aircraft send that by
			themselves, about once a second (acquisition squitter).
		</p>
	</InfoTip>
	<p>
		<span class="font-mono text-zinc-100">{r.code}</span>: {n(r.codeReplies)} replies from {r.codeAircraft}
		aircraft in the last {WINDOW_MS / 60_000} min. Replies less than {BURST_GAP_MS} ms apart are one
		<em>burst</em>: the few times the beam asked while it swept past, about 2.4° wide. That makes
		{n(r.codeBursts)} bursts, each with where its aircraft was then (from its ADS-B position).
	</p>
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip
		heading="h3"
		class="mb-2 text-xs font-medium text-zinc-400"
		label="2 · How fast it turns"
	>
		<p>
			The time between an aircraft's bursts is a whole number of turns: one, or more when a turn's
			replies didn't reach us. The period is the one that makes all the gaps whole numbers at once:
			each gap scores cos(2π · gap / period), 1 for a whole number of turns. Half or a third of the
			period would fit as well, so it's the longest that scores near the best.
		</p>
		<p>
			Approach radars near airports turn every 4–5 s (12–15 rpm); long-range en-route radars every
			8–12 s (5–7.5 rpm).
		</p>
	</InfoTip>
	<p>
		Bursts come every <strong class="text-zinc-100">{fixed(seconds, 3)} s</strong>, or two or three
		turns later:
	</p>
	<svg viewBox="0 0 {W} {H + AXIS}" class="my-2 w-full" role="img" aria-label="Gaps between bursts">
		{#each gapBins as count, i (i)}
			{#if count}
				<rect
					x={(i * GAP_BIN * W) / GAP_MAX}
					y={H - (count / gapTop) * (H - 4)}
					width={Math.max(1, (GAP_BIN * W) / GAP_MAX - 0.5)}
					height={(count / gapTop) * (H - 4)}
					class="fill-zinc-300"
				/>
			{/if}
		{/each}
		{#each Array.from({ length: Math.floor(GAP_MAX / seconds) }, (_, k) => k + 1) as k (k)}
			<line
				x1={(k * seconds * W) / GAP_MAX}
				x2={(k * seconds * W) / GAP_MAX}
				y1="0"
				y2={H}
				class="stroke-amber-300/60"
				stroke-dasharray="2 2"
			/>
		{/each}
		<line x1="0" x2={W} y1={H} y2={H} class="stroke-zinc-600" />
		{#each [0, 5, 10, 15, 20, 25, 30] as s (s)}
			<text
				x={(s * W) / GAP_MAX}
				y={H + AXIS - 2}
				class="fill-zinc-500 text-[9px]"
				text-anchor={s === 0 ? 'start' : 'middle'}>{s} s</text
			>
		{/each}
	</svg>
	<p class="text-zinc-400">
		<span class="text-amber-300">Dashed</span>: whole turns, {fixed(rpm, 1)} rpm. From the gaps alone
		it's {fixed(r.firstPeriod / 1000, 4)} s (score {fixed(r.periodScore, 2)} of 1); fitted together with
		the position below, over all the bursts, {fixed(seconds, 4)} s.
	</p>
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="3 · Where it stands">
		<p>
			If the beam turns steadily, it points at β(t) = 360° · (t − t<sub>0</sub>) / P. Each burst is
			a moment it pointed at an aircraft whose position we know. For a guessed radar position, the
			bearings from there to the aircraft must fit one such line through the bursts' times: the fit
			gives t<sub>0</sub> and P, and how far each burst is off, as an angle of the beam.
		</p>
		<p>
			The position is where the bursts are off the least: searched on a 25 km grid within 600 km of
			the aircraft (the radio horizon), both directions of rotation, then refined. A burst more than {OUTLIER}°
			off counts as {OUTLIER}°, so one stray reply can't pull it.
		</p>
	</InfoTip>
	<p>
		Here the fit explains <strong class="text-zinc-100"
			>{n(r.explained)} of {n(r.considered)}</strong
		>
		bursts to within {INLIER}°, half of them within {r.median.toFixed(2)}°:
	</p>
	<svg
		viewBox="0 0 {W} {H + AXIS}"
		class="my-2 w-full"
		role="img"
		aria-label="How far each burst is off"
	>
		<rect
			x={((MISS_MAX - INLIER) * W) / (2 * MISS_MAX)}
			width={(2 * INLIER * W) / (2 * MISS_MAX)}
			y="0"
			height={H}
			class="fill-zinc-800"
		/>
		{#each missBins as count, i (i)}
			{#if count}
				<rect
					x={(i * W) / (2 * MISS_MAX) + 0.5}
					y={H - (count / missTop) * (H - 4)}
					width={W / (2 * MISS_MAX) - 1}
					height={(count / missTop) * (H - 4)}
					class="fill-zinc-300"
				/>
			{/if}
		{/each}
		<line x1="0" x2={W} y1={H} y2={H} class="stroke-zinc-600" />
		{#each [-20, -10, -5, 0, 5, 10, 20] as d (d)}
			<text
				x={((d + MISS_MAX) * W) / (2 * MISS_MAX)}
				y={H + AXIS - 2}
				class="fill-zinc-500 text-[9px]"
				text-anchor={d === -20 ? 'start' : d === 20 ? 'end' : 'middle'}>{d}°</text
			>
		{/each}
	</svg>
	<p class="text-zinc-400">
		Grey band: within {INLIER}°.
		{#if beyond}
			{beyond === 1 ? 'One more is' : `${n(beyond)} more are`} further off than {MISS_MAX}°{r
				.sharing.length
				? ' (many of them the other radar’s)'
				: ''}.
		{/if}
		Turning the other way, the best fit at this spot explains only {plural(
			r.otherExplained,
			'burst'
		)}: it turns {r.clockwise ? 'clockwise' : 'anticlockwise'}, seen from above.
	</p>
	<p class="mt-2 text-zinc-400">
		To count, a radar needs at least {MIN_BURSTS} explained bursts, {MIN_AIRCRAFT} aircraft with {MIN_PER_AIRCRAFT}
		or more each, and {pct(MIN_SHARE)} of the bursts it was fitted to.
	</p>
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="4 · How sure">
		<p>
			Fit again without each aircraft in turn (a jackknife): if the position hangs on one aircraft,
			it moves a lot. The spread of those fits gives the dashed ellipse on the map, two standard
			errors across.
		</p>
		<p>
			Bearings pin a radar down sideways, but hardly how far away it is: seen from a distant radar,
			the aircraft sit in a small slice of its sky. So far radars get long, thin ellipses pointing
			at the aircraft.
		</p>
		<p>
			The jackknife misses what all the bursts get wrong together (the beam is about 2.4° wide; the
			positions are up to half a second old), so the map draws the ellipse at least {km(
				MIN_ELLIPSE_KM
			)} either way. Longer than {km(MAX_ELLIPSE_KM)} (from the middle), the radar isn't shown: that's
			a line of places it could be, not a place.
		</p>
	</InfoTip>
	<p>
		The ellipse is {km(r.spread.major)} along {directionText(r.spread.bearing)}/{directionText(
			(r.spread.bearing + 180) % 360
		)}
		and {km(r.spread.minor)} across{#if shown.major !== r.spread.major || shown.minor !== r.spread.minor}
			(drawn {km(shown.major)} × {km(shown.minor)}){/if}. Without each aircraft the position moves:
	</p>
	<ul class="mt-1 space-y-0.5 font-mono text-xs text-zinc-400">
		{#each moves as m (m.icao)}
			<li>
				<span class="text-zinc-300">{tracked.get(m.icao)?.callsign?.value ?? m.icao}</span>
				{km(m.km)}
			</li>
		{/each}
	</ul>
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="Who answered">
		<p>
			Every aircraft with bursts to this code, with how many the fit explains. Many unexplained
			bursts: it answered another radar with the same code, or was too far away for a good position.
		</p>
	</InfoTip>
	<ul class="space-y-0.5 text-zinc-300">
		{#each r.aircraft as a (a.icao)}
			{@const t = tracked.get(a.icao)}
			<li class="flex justify-between gap-4 tabular-nums">
				{#if t}
					<button
						type="button"
						class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
						onclick={() => onselect(a.icao)}>{t.callsign?.value ?? a.icao}</button
					>
				{:else}
					<span class="font-mono text-zinc-500">{a.icao}</span>
				{/if}
				<span class="text-zinc-400">{a.explained} of {plural(a.bursts, 'burst')}</span>
			</li>
		{/each}
	</ul>
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<InfoTip heading="h3" class="mb-2 text-xs font-medium text-zinc-400" label="The beam">
		<p>
			The line sweeping round on the map is the fit's prediction, not something we receive: where
			β(t) says the beam points now. It should pass over each aircraft just as its replies come in.
		</p>
		<p>
			It's drawn while the radar is heard (the last {BEAM_FRESH_MS / 60_000} min): a period good to a
			tenth of a millisecond still drifts a degree in a few minutes.
		</p>
		<p>
			The radar is fitted again about twice a minute on the bursts of the last {WINDOW_MS / 60_000} minutes.
		</p>
	</InfoTip>
	<p>
		{#if heard}
			Last explained burst {ago(now - r.heard)}. Found {ago(now - r.found)}, fitted again {ago(
				now - r.fitted
			)}.
		{:else}
			Not heard for {ago(now - r.heard).replace(' ago', '')}: no beam, the position stays.
		{/if}
	</p>
</section>

<RadarList {radars} {candidates} current={r.id} {now} {receiver} {unit} {onselectradar} />
<RadarCodes codes={others} label="Other codes heard" {onselectradar} />
