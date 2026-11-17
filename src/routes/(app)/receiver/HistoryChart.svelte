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
	const LEFT = 52;
	const RIGHT = 8;
	const TOP = 8;
	const BOTTOM = 20;
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
			<text x={LEFT - 6} y={y(v) + 3} text-anchor="end" class="fill-zinc-500 text-[10px]"
				>{format(v)}</text
			>
		{/each}
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
