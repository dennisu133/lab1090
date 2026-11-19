<!-- The circled "i" after every label that has an explanation (InfoTip). -->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let { class: size }: { class?: ClassValue } = $props();
</script>

<Icon class={size}>
	<circle cx="10" cy="10" r="7.25" />
	<path d="M10 9.25v4.5" />
	<circle cx="10" cy="6.4" r="0.95" fill="currentColor" stroke="none" />
</Icon>
