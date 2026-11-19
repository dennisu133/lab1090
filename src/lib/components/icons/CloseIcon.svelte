<!-- The cross on every close and dismiss button, and on a filter chip ("DF17 only ✕"). -->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let { class: size = 'size-4' }: { class?: ClassValue } = $props();
</script>

<Icon class={size}><path d="M5 5l10 10M15 5 5 15" /></Icon>
