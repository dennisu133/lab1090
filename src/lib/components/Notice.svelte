<!--
	The pill that floats over the page: the live list's "paused while you scroll"
	(PauseButton.svelte) and the alert banner (routes/AlertBanner.svelte). The content brings
	its own buttons; where it floats is up to them. The colour says what kind of notice it is:
	sky for the live lists, red for an emergency, amber for a caution (an ACAS advisory, a
	priority flight).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tone: 'live' | 'emergency' | 'caution';
		children: Snippet;
	}

	let { tone, children }: Props = $props();

	const TONES = {
		live: 'border-accent-800 bg-accent-950/95 text-accent-100',
		emergency: 'border-error-700 bg-error-950/95 text-error-100',
		caution: 'border-warn-700 bg-warn-950/95 text-warn-100'
	};
</script>

<div
	class={[
		'flex max-w-[calc(100vw-2rem)] items-stretch overflow-hidden rounded-full border text-sm shadow-xl',
		TONES[tone]
	]}
>
	{@render children()}
</div>
