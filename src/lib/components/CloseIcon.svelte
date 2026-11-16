<!--
	The cross on every close and dismiss button. Drawn, not the "✕" character: the UI font
	has no such glyph, so the browser took it from a fallback font, where it looked like a
	thin letter X. Same stroke as the navigation's menu icon; takes the button's text colour.
-->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	let { class: size = 'size-4' }: { class?: ClassValue } = $props();
</script>

<svg viewBox="0 0 20 20" class={size} aria-hidden="true">
	<path
		d="M5 5l10 10M15 5 5 15"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
	/>
</svg>
