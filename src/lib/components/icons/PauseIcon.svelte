<!-- Pause (two bars) while a live list runs, play (a triangle) while it's paused, in a circle
     like InfoIcon's: a control, not a character of the heading. -->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let { paused, class: size }: { paused: boolean; class?: ClassValue } = $props();
</script>

<Icon class={size}>
	<circle cx="10" cy="10" r="7.25" />
	{#if paused}
		<path d="M8.25 6.75v6.5L13.75 10Z" />
	{:else}
		<path d="M7.75 6.75v6.5M12.25 6.75v6.5" />
	{/if}
</Icon>
