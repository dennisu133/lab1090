<!--
	A label with an explanation that appears on hover (mouse), focus (keyboard) or a tap (touch).
	The tooltip lives inside the same element as the label, so moving the pointer onto it keeps it
	open. Escape hides it without moving the pointer or focus (WCAG 1.4.13). It resets the text
	styles it would otherwise inherit (e.g. `whitespace-nowrap` from a table header).

	For screen readers the label is a button that says whether its explanation is expanded, and
	the explanation follows it, to be read like the page around it. Not `aria-describedby`: that
	would read paragraphs and tables as one flat sentence, and some screen readers skip
	descriptions while reading the page.

	The tooltip is a popover: drawn in the top layer, above everything, so no box that scrolls
	or clips its content (a table's sideways scroller, the tracker's side panel) cuts it off, and
	it never makes the page scroll sideways. CSS anchor positioning places it at its label, on
	whichever side, below or above, has more room (most-height), lined up with the label's edge
	that `align` names, else with the other one, else centred under the label and moved inside
	the window (the last resorts are in layout.css). Taller than that room, it scrolls inside: it
	stays put in the window, so scrolling the page wouldn't bring the rest into view. "manual":
	the browser closes nothing by itself, `open` alone decides. Browsers without anchor
	positioning show it in the middle of the window.

	For a section title, pass `heading="h2"`: only the label goes inside the heading, the
	tooltip sits next to it (a heading may only contain text, not paragraphs or tables). A
	heading is marked by the ⓘ alone: it already stands out, the dotted line under it too was
	one marker too many.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import InfoIcon from './icons/InfoIcon.svelte';

	interface Props {
		/** The visible text that gets the tooltip: a snippet for markup (a formula's <sub>). */
		label: string | Snippet;
		/** Wrap the label in a heading element. */
		heading?: 'h2' | 'h3';
		/** Classes for the label (or heading). */
		class?: ClassValue;
		/** Which edge of the label the tooltip lines up with first ('right' for right-aligned labels). */
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
	/** Ties the tooltip to its label (anchor names are page-wide, so one per tooltip). */
	const id = $props.id();
	const anchor = `--info-${id}`;
	/** The label and tooltip together: a tap outside it closes a tapped-open tooltip. */
	let wrapper: HTMLDivElement | undefined;
	/** What pressed the button: a click from a mouse or pen is already a hover. */
	let pressedBy = '';

	/** Show or hide the popover with `open`. */
	function popover(tip: HTMLElement) {
		const shown = tip.matches(':popover-open');
		if (open && !shown) tip.showPopover();
		else if (!open && shown) tip.hidePopover();
	}

	/**
	 * Hover (not touch: it would end with the tap) and focus on the label or the tooltip. The
	 * tooltip is still inside this element in the page's tree, only drawn elsewhere, so moving
	 * onto it is no leaving.
	 */
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
</script>

<div class="group inline-block" {@attach follow}>
	<svelte:element this={heading ?? 'span'} class={labelClass}>
		<button
			type="button"
			style:anchor-name={anchor}
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
			{#if typeof label === 'string'}{label}{:else}{@render label()}{/if}<InfoIcon
				class="ml-1 inline-block size-[1em] align-[-0.125em] text-zinc-500"
			/>
		</button>
	</svelte:element>
	<!-- p-2: a see-through margin, part of the tooltip. Above and below, the gap to the label:
	     the pointer crossing it stays on the tooltip. At the sides, room to the window's edge;
	     the negative margin on the label's side lines the box up with the label (flip-inline
	     swaps it with the alignment). Widths include it: w-100 = 384 px of box. Fades in and
	     out (display and overlay switch at the end, so the fade-out shows). -->
	<div
		popover="manual"
		role="tooltip"
		style:position-anchor={anchor}
		{@attach popover}
		class={[
			'max-h-full max-w-screen flex-col overflow-visible bg-transparent p-2 open:flex',
			'm-auto supports-[position-area:block-end]:inset-auto supports-[position-area:block-end]:m-0',
			align === 'left'
				? '[position-area:block-end_span-inline-end] supports-[position-area:block-end]:-ms-2'
				: '[position-area:block-end_span-inline-start] supports-[position-area:block-end]:-me-2',
			'[position-try-fallbacks:flip-inline,--info-below,flip-block,flip-block_flip-inline,--info-above] [position-try-order:most-height]',
			'opacity-0 transition-[opacity,display,overlay] transition-discrete open:opacity-100 starting:open:opacity-0',
			wide ? 'w-164' : 'w-100'
		]}
	>
		<div
			class="min-h-0 space-y-2 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-left text-sm leading-relaxed font-normal tracking-normal whitespace-normal text-zinc-300 normal-case shadow-xl"
		>
			{@render children()}
		</div>
	</div>
</div>
