<!--
	One value over the last hour, from the server's 10-second points (RadioHistory). Gaps of
	more than one missed point break the line: the server wasn't running, or nothing measured.
-->
<script lang="ts">
	interface Props {
		/** Oldest first; t in ms since epoch (the server's clock). */
		series: { t: number; value: number | null }[];
		/** The axis' right end, ms since epoch: the newest point. */
		end: number;
		min: number;
		max: number;
		ticks: number[];
		format: (value: number) => string;
		/** A dashed line across, e.g. a threshold. */
		reference?: { value: number; label: string } | null;
		/** Tailwind stroke class for the line. */
		color: string;
		/** For screen readers: what the chart shows. */
		label: string;
	}

	let { series, end, min, max, ticks, format, reference = null, color, label }: Props = $props();

	/** The viewBox is the chart's width in px, so the labels keep their size. */
	let width = $state(0);
	let W = $derived(Math.max(width, 300));
	const H = 160;
	/**
	 * The space around the drawing: as much at the sides as above the top label and below the
	 * time axis (about 4 px each). On the left, that plus the widest value label and its gap
	 * to the grid.
	 */
	const INSET = 4;
	const LABEL_GAP = 6;
	const RIGHT = INSET;
	const TOP = 8;
	const BOTTOM = 20;
	/**
	 * The widest value label, px, measured once drawn. Until then (and while the chart is
	 * hidden, as in a closed tooltip, where nothing has a size) a guess: 6 px a character.
	 */
	let measured = $state(0);
	let yLabels = $state<SVGGElement>();
	let labelWidth = $derived(measured || Math.max(...ticks.map((v) => format(v).length)) * 6);
	let LEFT = $derived(INSET + labelWidth + LABEL_GAP);
	$effect(() => {
		// Again when the labels change, and once the chart is shown (its width becomes known).
		void [ticks, format, width];
		measured = yLabels?.getBBox().width ?? 0;
	});
	const HOUR = 3_600_000;
	/** Points farther apart than this aren't joined, ms. */
	const GAP = 25_000;

	const x = (t: number) => LEFT + ((t - (end - HOUR)) / HOUR) * (W - LEFT - RIGHT);
	const y = (v: number) =>
		H - BOTTOM - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * (H - TOP - BOTTOM);

	let path = $derived.by(() => {
		let d = '';
		let previous: number | null = null;
		for (const p of series) {
			if (p.value === null || p.t < end - HOUR) {
				previous = null;
				continue;
			}
			const joined = previous !== null && p.t - previous <= GAP;
			d += `${joined ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`;
			previous = p.t;
		}
		return d;
	});

	const MINUTES = [60, 45, 30, 15, 0];
</script>

<div bind:clientWidth={width}>
	<svg viewBox="0 0 {W} {H}" class="w-full" role="img" aria-label={label}>
		{#each ticks as v (v)}
			<line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} class="stroke-zinc-800" />
		{/each}
		<g bind:this={yLabels}>
			{#each ticks as v (v)}
				<text x={LEFT - LABEL_GAP} y={y(v) + 3} text-anchor="end" class="fill-zinc-500 text-[10px]"
					>{format(v)}</text
				>
			{/each}
		</g>
		{#each MINUTES as m (m)}
			<text
				x={x(end - m * 60_000)}
				y={H - 4}
				text-anchor={m === 0 ? 'end' : m === 60 ? 'start' : 'middle'}
				class="fill-zinc-500 text-[10px]">{m === 0 ? 'now' : `−${m} min`}</text
			>
		{/each}
		{#if reference}
			<line
				x1={LEFT}
				x2={W - RIGHT}
				y1={y(reference.value)}
				y2={y(reference.value)}
				class="stroke-amber-400/60"
				stroke-dasharray="4 4"
			/>
			<text
				x={W - RIGHT - 2}
				y={y(reference.value) - 4}
				text-anchor="end"
				class="fill-amber-400/80 text-[10px]">{reference.label}</text
			>
		{/if}
		<path d={path} class={['fill-none', color]} stroke-width="1.5" stroke-linejoin="round" />
	</svg>
</div>
