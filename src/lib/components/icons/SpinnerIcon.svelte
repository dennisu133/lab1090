<!-- Something is being worked on: a quarter of a ring turning on a faint full one. It turns
     only for those who allow motion; still, it is a ring with a bright arc. -->
<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let { class: size }: { class?: ClassValue } = $props();
</script>

<Icon class={[size ?? 'inline-block size-[1em] align-[-0.125em]', 'motion-safe:animate-spin']}>
	<circle cx="10" cy="10" r="7" opacity="0.25" />
	<path d="M10 3a7 7 0 0 1 7 7" />
</Icon>
