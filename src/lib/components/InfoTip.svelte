<!--
	A label with an explanation that appears on hover (mouse) or focus (keyboard, tap).
	Showing it is pure CSS: the tooltip lives inside the same `group`, so moving the pointer onto it
	keeps it open. It resets the text styles it would otherwise inherit (e.g. `whitespace-nowrap`
	from a table header).

	Placing it takes a little JS: `align` says which edge it lines up with, but where a label ends
	up depends on the window width, so the tooltip is shifted sideways to stay inside the window.
	Even hidden it takes up room: left sticking out, it would make the whole page scroll sideways.

	For a section title, pass `heading="h2"`: only the label goes inside the heading, the
	tooltip sits next to it (a heading may only contain text, not paragraphs or tables).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** The visible text that gets the tooltip. */
		label: string;
		/** Wrap the label in a heading element. */
		heading?: 'h2' | 'h3';
		/** Classes for the label (or heading). */
		class?: ClassValue;
		/** Which edge the tooltip lines up with; use 'right' near the right side of the page. */
		align?: 'left' | 'right';
		/** Room for longer explanations, e.g. with a table. */
		wide?: boolean;
		children: Snippet;
	}

	let {
		label,
		heading,
		class: labelClass,
		align = 'left',
		wide = false,
		children
	}: Props = $props();

	const id = $props.id();

	/** Keep this far from the window's edges, px. */
	const MARGIN = 8;

	/**
	 * Move the tooltip sideways so it stays inside the window: right away, on resize, and
	 * whenever it opens (the label may have moved since, e.g. when a header wrapped).
	 */
	function keepInWindow(anchor: HTMLDivElement) {
		const tip = anchor.querySelector<HTMLElement>('[role="tooltip"]')!;
		const place = () => {
			const box = anchor.getBoundingClientRect();
			const width = tip.offsetWidth;
			const viewport = document.documentElement.clientWidth;
			// Where it goes unshifted: lined up with the label's left or right edge.
			const left = align === 'left' ? box.left : box.right - width;
			const intoView = Math.min(0, viewport - MARGIN - (left + width));
			const shift = Math.max(intoView, MARGIN - left);
			// `left` (relative to the label), not a transform: Chrome counts a transformed
			// element's untransformed box when sizing the page, so it would still scroll.
			tip.style.left = `${left + shift - box.left}px`;
		};
		place();
		anchor.addEventListener('pointerenter', place);
		anchor.addEventListener('focusin', place);
		window.addEventListener('resize', place);
		return () => {
			anchor.removeEventListener('pointerenter', place);
			anchor.removeEventListener('focusin', place);
			window.removeEventListener('resize', place);
		};
	}
</script>

<div class="group relative inline-block" {@attach keepInWindow}>
	<svelte:element this={heading ?? 'span'} class={labelClass}>
		<button
			type="button"
			aria-describedby={id}
			class="cursor-help [text-transform:inherit] underline decoration-zinc-600 decoration-dotted underline-offset-4 group-hover:text-zinc-200"
		>
			{label}<span aria-hidden="true" class="ml-1 text-zinc-500">ⓘ</span>
		</button>
	</svelte:element>
	<div
		{id}
		role="tooltip"
		class={[
			'invisible absolute top-full z-20 pt-2 opacity-0 transition-opacity',
			'group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
			wide ? 'w-160' : 'w-96',
			'max-w-[calc(100vw-1rem)]',
			align === 'left' ? 'left-0' : 'right-0'
		]}
	>
		<div
			class="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-left text-sm leading-relaxed font-normal tracking-normal whitespace-normal text-zinc-300 normal-case shadow-xl"
		>
			{@render children()}
		</div>
	</div>
</div>
