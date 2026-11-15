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
		live: 'border-sky-800 bg-sky-950/95 text-sky-100',
		emergency: 'border-red-700 bg-red-950/95 text-red-100',
		caution: 'border-amber-700 bg-amber-950/95 text-amber-100'
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
