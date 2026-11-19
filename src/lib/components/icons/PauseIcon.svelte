<!-- Pause (two bars) while a live list runs, play (a triangle) while it's paused. -->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let { paused, class: size }: { paused: boolean; class?: ClassValue } = $props();
</script>

<Icon class={size}>
	{#if paused}
		<path d="M6.25 3.75v12.5L16.25 10Z" />
	{:else}
		<path d="M7 3.75v12.5M13 3.75v12.5" />
	{/if}
</Icon>
