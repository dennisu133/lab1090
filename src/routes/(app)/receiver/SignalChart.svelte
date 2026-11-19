<!--
	Signal against distance: a dot per aircraft every 10 s (SignalStream), the free-space line
	fitted to them (lib/radio/path-loss.ts), the noise level across, and along the right edge
	the signal histogram of every message since the server started (FrameCounts' 3 dB
	buckets), on the same dBFS axis. Distance on a log scale: free space is then a straight
	line, 20 dB down per factor ten.
-->
<script lang="ts">
	import { n } from '#lib/describe/format.ts';
	import { SIGNAL_BUCKET_DB } from '#lib/modes/frame.ts';
	import { freeSpace, type SignalPoint } from '#lib/radio/path-loss.ts';
	import { themeColour, type ThemeColour } from '#lib/theme.ts';

	interface Props {
		points: SignalPoint[];
		/** The free-space line's level at 1 km (freeSpaceLevel); null: no points. */
		level: number | null;
		/** Noise level, dBFS; null: not measured (a Beast feed). */
		noise: number | null;
		/** Messages per 3 dB bucket, keyed by the lower edge (ReceiverCounts.bySignal). */
		histogram: Record<number, number>;
	}

	let { points, level, noise, histogram }: Props = $props();

	/** The viewBox is the chart's width in px, so the labels keep their size. */
	let width = $state(0);
	let W = $derived(Math.max(width, 600));
	const H = 360;
	const LEFT = 48;
	/** The histogram takes the last BARS px on the right. */
	const BARS = 150;
	let PLOT_RIGHT = $derived(W - BARS - 24);
	let BARS_LEFT = $derived(W - BARS);
	const RIGHT = 8;
	const TOP = 10;
	const BOTTOM = 30;
	const KM_MIN = 1;
	const KM_MAX = 500;
	const DB_MIN = -48;
	const DB_MAX = 0;

	const x = (km: number) =>
		LEFT +
		((Math.log10(Math.min(Math.max(km, KM_MIN), KM_MAX)) - Math.log10(KM_MIN)) /
			(Math.log10(KM_MAX) - Math.log10(KM_MIN))) *
			(PLOT_RIGHT - LEFT);
	const y = (db: number) =>
		TOP +
		((DB_MAX - Math.min(Math.max(db, DB_MIN), DB_MAX)) / (DB_MAX - DB_MIN)) * (H - TOP - BOTTOM);

	const KM_TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
	const DB_TICKS = [0, -6, -12, -18, -24, -30, -36, -42, -48];

	/** The elevation bands the dots are coloured by: a vertical antenna hears little overhead. */
	const BANDS: { below: number; colour: ThemeColour; label: string }[] = [
		{ below: 5, colour: 'blue-400', label: 'below 5°' },
		{ below: 20, colour: 'green-400', label: '5–20°' },
		{ below: 91, colour: 'amber-400', label: 'above 20°' }
	];
	const colourOf = (elevation: number | null): ThemeColour =>
		elevation === null ? 'zinc-500' : BANDS.find((b) => elevation < b.below)!.colour;

	let bins = $derived.by(() => {
		const out = [];
		for (let k = DB_MIN; k < DB_MAX; k += SIGNAL_BUCKET_DB)
			out.push({ key: k, count: histogram[k] ?? 0 });
		return out;
	});
	let most = $derived(Math.max(1, ...bins.map((b) => b.count)));

	/**
	 * The free-space line's ends: where it enters and leaves the plot (cut there, not clamped,
	 * which would bend it). It's DB_MAX at 10^(level/20) km and DB_MIN at 10^((level − DB_MIN)/20).
	 */
	let line = $derived.by(() => {
		if (level === null) return null;
		const from = Math.max(KM_MIN, 10 ** ((level - DB_MAX) / 20));
		const to = Math.min(KM_MAX, 10 ** ((level - DB_MIN) / 20));
		return from < to ? { level, from, to } : null;
	});

	/** The dots, on a canvas under the SVG: there can be thousands. */
	function dots(canvas: HTMLCanvasElement) {
		const scale = window.devicePixelRatio || 1;
		const px = W * scale;
		canvas.width = px;
		canvas.height = (px * H) / W;
		const ctx = canvas.getContext('2d')!;
		const k = px / W;
		ctx.globalAlpha = 0.7;
		const fill: Partial<Record<ThemeColour, string>> = {};
		for (const p of points) {
			const c = colourOf(p.elevation);
			ctx.fillStyle = fill[c] ??= themeColour(c);
			ctx.beginPath();
			ctx.arc(x(p.km) * k, y(p.dbfs) * k, 1.6 * k, 0, 2 * Math.PI);
			ctx.fill();
		}
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<canvas class="pointer-events-none absolute inset-0 h-full w-full" {@attach dots}></canvas>
	<svg
		viewBox="0 0 {W} {H}"
		class="relative w-full"
		role="img"
		aria-label="Signal level against distance, with the free-space line, the noise level and the signal histogram"
	>
		{#each DB_TICKS as db (db)}
			<line x1={LEFT} x2={PLOT_RIGHT} y1={y(db)} y2={y(db)} class="stroke-zinc-800" />
			<text x={LEFT - 6} y={y(db) + 3} text-anchor="end" class="fill-zinc-500 text-[10px]"
				>{n(db)}</text
			>
		{/each}
		{#each KM_TICKS as km (km)}
			<line x1={x(km)} x2={x(km)} y1={TOP} y2={H - BOTTOM} class="stroke-zinc-800" />
			<text x={x(km)} y={H - BOTTOM + 14} text-anchor="middle" class="fill-zinc-500 text-[10px]"
				>{km}</text
			>
		{/each}
		<text x={PLOT_RIGHT} y={H - 2} text-anchor="end" class="fill-zinc-500 text-[10px]"
			>km along the line of sight</text
		>
		<text x={4} y={TOP + 2} class="fill-zinc-500 text-[10px]" dominant-baseline="hanging">dBFS</text
		>
		{#if points.length === 0}
			<text
				x={(LEFT + PLOT_RIGHT) / 2}
				y={(TOP + H - BOTTOM) / 2}
				text-anchor="middle"
				class="fill-zinc-500 text-xs">No aircraft with a position yet</text
			>
		{/if}

		{#if noise !== null}
			<line
				x1={LEFT}
				x2={W - RIGHT}
				y1={y(noise)}
				y2={y(noise)}
				class="stroke-zinc-400"
				stroke-dasharray="4 4"
			/>
			<text x={LEFT + 4} y={y(noise) - 4} class="fill-zinc-400 text-[10px]">noise</text>
		{/if}
		{#if line}
			<line
				x1={x(line.from)}
				y1={y(freeSpace(line.level, line.from))}
				x2={x(line.to)}
				y2={y(freeSpace(line.level, line.to))}
				class="stroke-blue-300"
				stroke-dasharray="6 3"
			/>
		{/if}

		{#each bins as b (b.key)}
			{@const top = y(b.key + SIGNAL_BUCKET_DB)}
			<rect
				x={BARS_LEFT}
				y={top + 1}
				width={(b.count / most) * (W - RIGHT - BARS_LEFT)}
				height={Math.max(0, y(b.key) - top - 2)}
				class="fill-zinc-600"
			>
				<title>{n(b.key)} to {n(b.key + SIGNAL_BUCKET_DB)} dBFS: {n(b.count)} messages</title>
			</rect>
		{/each}
		<text x={BARS_LEFT} y={H - BOTTOM + 14} class="fill-zinc-500 text-[10px]">all messages</text>
	</svg>
</div>
<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
	<span>Elevation:</span>
	{#each BANDS as b (b.label)}
		<span class="flex items-center gap-1"
			><span class="size-2 rounded-full" style:background="var(--color-{b.colour})"
			></span>{b.label}</span
		>
	{/each}
	<span class="flex items-center gap-1"
		><span class="h-0 w-4 border-t border-dashed border-blue-300"></span>free space</span
	>
</div>
