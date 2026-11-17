<!--
	The receiver's panel (tap its white dot on the map): the antenna's coverage. What it
	shows, the sky plot, the numbers of the sector picked on it (its wedge on the map), a
	summary (the farthest position against its horizon, the open arcs), the terrain's part,
	and how to read the outlines on the map, which show while it's open.
-->
<script lang="ts">
	import CloseIcon from '#lib/components/CloseIcon.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { ago, distanceText } from '#lib/describe/aircraft.ts';
	import {
		BANDS,
		OPEN_DEG,
		SECTOR_DEG,
		summarize,
		type CoveragePoint
	} from '#lib/coverage/coverage.ts';
	import { radioHorizon } from '#lib/coverage/geometry.ts';
	import { ANTENNA_ABOVE_GROUND_M, MAX_KM, SKYLINE_STEP_DEG } from '#lib/coverage/terrain.ts';
	import { compass } from '#lib/geo.ts';
	import { altitudeCss } from '#lib/map/altitude.ts';
	import { HORIZON_FT } from '#lib/map/coverage.ts';
	import type { Unit } from '#lib/map/features.ts';
	import { BAND_COLOUR_FT } from '#lib/map/coverage.ts';
	import type { CoverageStream } from './coverage-stream.svelte';
	import SkyPlot from './SkyPlot.svelte';

	interface Props {
		stream: CoverageStream;
		unit: Unit;
		selected: number | null;
		onselect: (index: number | null) => void;
		onclose: () => void;
	}

	let { stream, unit, selected, onselect, onclose }: Props = $props();

	const km = (x: number) => distanceText(x, unit);
	const deg = (x: number) => `${x.toFixed(1)}°`;
	const fl = (ft: number) => `FL${Math.round(ft / 100)}`;
	const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
	const antennaKm = $derived(stream.terrain?.antennaKm ?? 0);
	const horizon = (ft: number) => radioHorizon(ft, antennaKm);

	let summary = $derived(summarize(stream.sectors, horizon));
	let sector = $derived(selected === null ? null : (stream.sectors[selected] ?? null));
	/** How high the land rises in a range of bearings, degrees (null: not loaded). */
	const terrainOver = (from: number, width: number) => {
		const sky = stream.terrain?.skyline;
		if (!sky) return null;
		let top = -90;
		for (let b = from; b < from + width; b += SKYLINE_STEP_DEG)
			top = Math.max(top, sky[Math.floor((b % 360) / SKYLINE_STEP_DEG)]);
		return top;
	};
	let terrainTop = $derived(terrainOver(0, 360));
	let collecting = $derived(
		stream.first !== null && stream.last !== null ? stream.last - stream.first : 0
	);
</script>

{#snippet who(p: CoveragePoint)}
	<span class="font-mono">{p.icao}</span>
	<span style:color={altitudeCss(p.altitude)}>{fl(p.altitude)}</span>
	· {km(p.distance)}
{/snippet}

<header class="flex items-start justify-between gap-4 px-4 py-3">
	<div class="min-w-0">
		<h2 class="text-xl font-semibold">Receiver coverage</h2>
		<p class="text-sm text-zinc-400">
			{#if stream.positions}
				{ago(collecting).replace(' ago', '')} of traffic · {stream.positions.toLocaleString('en')} positions
				·
				{summary.heard} of {360 / SECTOR_DEG} directions heard
			{:else}
				Waiting for positions…
			{/if}
		</p>
	</div>
	<button
		type="button"
		onclick={onclose}
		class="-mr-1.5 grid size-8 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
		aria-label="Close and show all aircraft"><CloseIcon /></button
	>
</header>

<p class="px-4 pb-3 text-sm text-zinc-300">
	Where this antenna hears aircraft. Distance mixes up how high they fly with what's in the way, so
	the plot uses the <em>elevation angle</em>: how far above the horizon each one stood, seen from
	the antenna. A wall or a hill hides everything below its own angle, near or far.
</p>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<h3 class="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">On the map</h3>
	<ul class="space-y-1">
		<li>
			<span class="font-medium text-zinc-100">Outlines</span>: the farthest position per {SECTOR_DEG}°
			direction, one per altitude band:
			{#each BANDS as band, i (band.name)}<span
					class="whitespace-nowrap"
					style:color={altitudeCss(BAND_COLOUR_FT[i])}>{band.name}</span
				>{i < BANDS.length - 1 ? ', ' : ''}{/each}.
		</li>
		<li>
			<span class="text-amber-300">Dashed amber</span>: the radio horizon at {fl(HORIZON_FT)},
			{km(horizon(HORIZON_FT))} out.
		</li>
		<li>Dots: the positions behind it, as on the plot below (only while this panel is open).</li>
	</ul>
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm">
	<InfoTip
		heading="h3"
		class="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
		label="The antenna's sky"
		wide
	>
		<p>
			Seen from below: north up, east right, like the map. The edge is the horizon (0°), the middle
			straight overhead (90°). The scale stretches the low angles, where coverage is decided.
		</p>
		<p>
			Elevation = atan((h − h<sub>antenna</sub> − d²/2R′) / d), with h the aircraft's altitude, d its
			distance along the ground and R′ the Earth's radius × 4/3: radio bends slightly round the Earth,
			as if it were that much flatter. The altitude is barometric, not a true height: a few hundred feet
			off, under 0.1° beyond 50 km.
		</p>
		<p>
			Light: where aircraft were heard, down to the lowest per sector. Dashed amber: the bare land's
			skyline, no buildings. Dots: positions, coloured by altitude.
		</p>
	</InfoTip>
	<SkyPlot
		sectors={stream.sectors}
		points={stream.points}
		terrain={stream.terrain?.skyline ?? null}
		{selected}
		{onselect}
	/>

	{#if sector}
		{@const terrain = terrainOver(sector.from, SECTOR_DEG)}
		<div class="mt-3 rounded border border-zinc-800 p-3">
			<div class="flex items-baseline justify-between">
				<h4 class="font-semibold text-zinc-100">
					{sector.from}–{sector.from + SECTOR_DEG}° ({compass(sector.from + SECTOR_DEG / 2)})
				</h4>
				<button
					type="button"
					class="-my-1 -mr-1.5 grid size-7 shrink-0 place-items-center self-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
					aria-label="Close the sector"
					onclick={() => onselect(null)}><CloseIcon /></button
				>
			</div>
			{#if sector.lowest}
				<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
					<dt>
						<InfoTip label="Heard down to">
							<p>
								The lowest elevation angle of any position in this sector, and that aircraft's
								altitude and distance. Below this angle nothing was heard here.
							</p>
						</InfoTip>
					</dt>
					<dd>{deg(sector.lowest.elevation)} · {@render who(sector.lowest)}</dd>
					{#if terrain !== null}
						<dt>
							<InfoTip label="Terrain up to">
								<p>
									How high the bare land rises in this sector, as seen from the antenna (out to {MAX_KM}
									km). Heard down to well above this: something near the antenna is in the way, not the
									land.
								</p>
							</InfoTip>
						</dt>
						<dd>{deg(terrain)}</dd>
					{/if}
					<dt>Traffic</dt>
					<dd>{sector.positions.toLocaleString('en')} from {sector.aircraft} aircraft</dd>
				</dl>
				<h5 class="mt-3 mb-1 text-xs text-zinc-500 uppercase">
					<InfoTip label="Farthest per altitude band">
						<p>
							The farthest position in each band, as a share of the radio horizon at its altitude.
						</p>
					</InfoTip>
				</h5>
				<ul class="space-y-0.5 tabular-nums">
					{#each BANDS as band, i (band.name)}
						{@const p = sector.farthest[i]}
						<li class="flex justify-between gap-3">
							<span class="text-zinc-400">{band.name}</span>
							{#if p}
								<span>{@render who(p)} ({pct(p.distance / horizon(p.altitude))})</span>
							{:else}
								<span class="text-zinc-600">–</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-zinc-400">
					Nothing heard here yet: blocked, or no aircraft have flown this way.
					{#if terrain !== null}The land rises to {deg(terrain)} here.{/if}
				</p>
			{/if}
		</div>
	{:else}
		<p class="mt-2 text-zinc-500">Tap a direction for its numbers.</p>
	{/if}
</section>

<section class="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-300">
	<h3 class="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">So far</h3>
	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
		<dt>
			<InfoTip label="Farthest">
				<p>
					The farthest position of all, and that distance as a share of the radio horizon at its
					altitude: √(2R′h) for each end, with R′ the 4/3 Earth (FL350 from sea level: {km(
						radioHorizon(HORIZON_FT)
					)}).
				</p>
				<p>
					Well short of it in a direction that's open down to a few degrees: the signal gives out
					before the Earth's curve does. A better antenna, a filter or an amplifier would help
					there; a higher one wouldn't.
				</p>
			</InfoTip>
		</dt>
		<dd>
			{#if summary.farthest}
				{@const p = summary.farthest.point}
				{@render who(p)}
				{compass(p.bearing)} ({pct(summary.farthest.ofHorizon)} of its horizon)
			{:else}
				–
			{/if}
		</dd>
		<dt>
			<InfoTip label="Open">
				<p>
					The directions where aircraft were heard within {OPEN_DEG}° of the horizon: nothing much
					in the way there. Neighbouring {SECTOR_DEG}° sectors run together, widest first.
				</p>
			</InfoTip>
		</dt>
		<dd>
			{#if summary.open.length}
				{summary.open
					.slice(0, 3)
					.map((a) => `${a.from}–${(a.from + a.width) % 360}°`)
					.join(', ')}
			{:else}
				none yet
			{/if}
		</dd>
		<dt>
			<InfoTip label="Terrain">
				<p>
					The bare land around the antenna, from the Terrain Tiles on AWS (mostly SRTM), traced out
					to {MAX_KM} km in every direction. The antenna is taken to stand {ANTENNA_ABOVE_GROUND_M} m
					above the ground there, a guess; it changes the angles by hundredths of a degree for aircraft
					more than a few km away.
				</p>
			</InfoTip>
		</dt>
		<dd>
			{#if stream.terrainState === 'ready' && terrainTop !== null}
				rises to {deg(terrainTop)} at most{#if stream.terrain?.ground !== null}; ground
					{Math.round(stream.terrain!.ground!)} m{/if}
			{:else if stream.terrainState === 'failed'}
				couldn't load the elevation tiles
			{:else}
				loading…
			{/if}
		</dd>
	</dl>
</section>
