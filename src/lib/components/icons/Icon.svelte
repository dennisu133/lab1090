<!--
	The shell every icon here is drawn in, so they all look alike: a 20-unit square, lines
	1.5 wide with round ends and corners, in the text's colour. Our own drawings, not
	characters: the UI font has none of these, and a fallback font's look depends on the machine.

	The default size, 1em, lowered by an eighth, sits on the text's baseline like a character
	("Wind ⓘ"). Buttons pass a size of their own (`size-4`).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	let { class: size, children }: { class?: ClassValue; children: Snippet } = $props();
</script>

<svg
	viewBox="0 0 20 20"
	class={size ?? 'inline-block size-[1em] align-[-0.125em]'}
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{@render children()}
</svg>
