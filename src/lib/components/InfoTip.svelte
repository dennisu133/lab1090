<!--
	A label with an explanation that appears on hover (mouse), focus (keyboard) or a tap (touch).
	The tooltip lives inside the same element as the label, so moving the pointer onto it keeps it
	open. Escape hides it without moving the pointer or focus (WCAG 1.4.13). It resets the text
	styles it would otherwise inherit (e.g. `whitespace-nowrap` from a table header).

	For screen readers the label is a button that says whether its explanation is expanded, and
	the explanation follows it, to be read like the page around it. Not `aria-describedby`: that
	would read paragraphs and tables as one flat sentence, and some screen readers skip
	descriptions while reading the page.

	Placing it takes a little JS: `align` says which edge it lines up with, but where a label ends
	up depends on the window width, so the tooltip is shifted sideways to stay inside the window,
	or inside the nearest box that clips its content (a scrolling side panel: the tracker's list
	would cut it off at the map's edge), narrowed if that box is narrower. Even hidden it takes up
	room: left sticking out, it would make the whole page scroll sideways.

	For a section title, pass `heading="h2"`: only the label goes inside the heading, the
	tooltip sits next to it (a heading may only contain text, not paragraphs or tables). A
	heading is marked by the ⓘ alone: it already stands out, the dotted line under it too was
	one marker too many.
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
		/** Open above the label instead of below: for labels at the bottom of the screen. */
		above?: boolean;
		children: Snippet;
	}

	let {
		label,
		heading,
		class: labelClass,
		align = 'left',
		wide = false,
		above = false,
		children
	}: Props = $props();

	/**
	 * Open while the mouse is over the label or the tooltip, while focus is inside, or after a
	 * tap (touch has no hover: open until a tap elsewhere). Escape closes it until the pointer
	 * or focus comes back.
	 */
	let hovered = $state(false);
	let focused = $state(false);
	let tapped = $state(false);
	let dismissed = $state(false);
	let open = $derived((hovered || focused || tapped) && !dismissed);
	/** The label and tooltip together: a tap outside it closes a tapped-open tooltip. */
	let wrapper: HTMLDivElement | undefined;
	/** What pressed the button: a click from a mouse or pen is already a hover. */
	let pressedBy = '';

	/** Hover (not touch: it would end with the tap) and focus on the label or the tooltip. */
	function follow(node: HTMLDivElement) {
		wrapper = node;
		const enter = (event: PointerEvent) => {
			if (event.pointerType === 'touch') return;
			hovered = true;
			dismissed = false;
		};
		const leave = (event: PointerEvent) => {
			if (event.pointerType !== 'touch') hovered = false;
		};
		const focusIn = () => {
			focused = true;
			dismissed = false;
		};
		const focusOut = (event: FocusEvent) => {
			if (node.contains(event.relatedTarget as Node | null)) return;
			focused = false;
			tapped = false;
		};
		node.addEventListener('pointerenter', enter);
		node.addEventListener('pointerleave', leave);
		node.addEventListener('focusin', focusIn);
		node.addEventListener('focusout', focusOut);
		return () => {
			node.removeEventListener('pointerenter', enter);
			node.removeEventListener('pointerleave', leave);
			node.removeEventListener('focusin', focusIn);
			node.removeEventListener('focusout', focusOut);
		};
	}

	$effect(() => {
		if (!open) return;
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') dismissed = true;
		};
		window.addEventListener('keydown', escape);
		return () => window.removeEventListener('keydown', escape);
	});
	$effect(() => {
		if (!tapped) return;
		const outside = (event: PointerEvent) => {
			if (wrapper && !event.composedPath().includes(wrapper)) tapped = false;
		};
		window.addEventListener('pointerdown', outside);
		return () => window.removeEventListener('pointerdown', outside);
	});

	/** Keep this far from the window's edges, px. */
	const MARGIN = 8;

	/**
	 * The room the tooltip has across, in window coordinates: the window, narrowed to the
	 * nearest ancestor that clips sideways (overflow other than visible; a vertical scroller
	 * clips sideways too).
	 */
	function room(anchor: HTMLElement): { left: number; right: number } {
		let left = 0;
		let right = document.documentElement.clientWidth;
		for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
			if (getComputedStyle(el).overflowX === 'visible') continue;
			const box = el.getBoundingClientRect();
			left = Math.max(left, box.left + el.clientLeft);
			right = Math.min(right, box.left + el.clientLeft + el.clientWidth);
			break;
		}
		return { left, right };
	}

	/**
	 * Move the tooltip sideways so it stays inside its room: right away, on resize, and
	 * whenever it opens (the label may have moved since, e.g. when a header wrapped).
	 */
	function keepInWindow(anchor: HTMLDivElement) {
		const tip = anchor.querySelector<HTMLElement>('[role="tooltip"]')!;
		const place = () => {
			const box = anchor.getBoundingClientRect();
			const bounds = room(anchor);
			tip.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - 2 * MARGIN)}px`;
			const width = tip.offsetWidth;
			// Where it goes unshifted: lined up with the label's left or right edge.
			const left = align === 'left' ? box.left : box.right - width;
			const intoView = Math.min(0, bounds.right - MARGIN - (left + width));
			const shift = Math.max(intoView, bounds.left + MARGIN - left);
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

<div class="group relative inline-block" {@attach keepInWindow} {@attach follow}>
	<svelte:element this={heading ?? 'span'} class={labelClass}>
		<button
			type="button"
			aria-expanded={open}
			onpointerdown={(event) => (pressedBy = event.pointerType)}
			onclick={() => {
				// Touch, or Enter/Space (no pointer): show it, like a toggletip.
				if (pressedBy !== 'mouse' && pressedBy !== 'pen') {
					tapped = true;
					dismissed = false;
				}
				pressedBy = '';
			}}
			class={[
				'cursor-help [text-transform:inherit] group-hover:text-zinc-200',
				!heading && 'underline decoration-zinc-600 decoration-dotted underline-offset-4'
			]}
		>
			{label}<span aria-hidden="true" class="ml-1 text-zinc-500">ⓘ</span>
		</button>
	</svelte:element>
	<div
		role="tooltip"
		class={[
			'absolute z-20 transition-opacity',
			above ? 'bottom-full pb-2' : 'top-full pt-2',
			open ? 'visible opacity-100' : 'invisible opacity-0',
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
