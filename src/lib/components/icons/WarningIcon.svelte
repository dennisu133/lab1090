<!-- The warning triangle in front of an alert (AlertBanner). -->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let { class: size }: { class?: ClassValue } = $props();
</script>

<Icon class={size}>
	<path d="M10 3 17.75 16.5H2.25Z" />
	<path d="M10 8v3.75" />
	<circle cx="10" cy="14" r="0.95" fill="currentColor" stroke="none" />
</Icon>
