<!--
	The top of a side panel (aircraft, receiver, radar, airport): its title part, and the
	button that closes it, back to the list of all aircraft.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import CloseIcon from '#lib/components/icons/CloseIcon.svelte';

	interface Props {
		/** The heading and the line under it. */
		children: Snippet;
		onclose: () => void;
	}

	let { children, onclose }: Props = $props();
</script>

<header class="flex items-start justify-between gap-4 px-4 py-3">
	<div class="min-w-0">
		{@render children()}
	</div>
	<button
		type="button"
		onclick={onclose}
		class="-mr-1.5 grid size-8 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
		aria-label="Close and show all aircraft"><CloseIcon /></button
	>
</header>
