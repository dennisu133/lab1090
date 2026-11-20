<!--
	A live list's heading, "Live frames ⏸", which pauses the list: a click on the heading or
	the icon pauses it, another resumes it (the icon then a ▶, with how many arrived since). It
	also pauses by itself while you read.

	New items go on top of the list. Once you scroll down into it, every batch (4 a second)
	would push the rows you're reading further down. So as soon as this heading scrolls out of
	view at the top, the list pauses. When it comes back into view, the list resumes and shows
	what arrived in the meantime. The click stays in charge: if you paused with it, scrolling
	back up doesn't resume.

	While paused by scrolling, a notice at the top of the window says so, so the list never
	looks frozen without a reason (below the alert banner, if there is one). Clicking it
	scrolls back up to the list's heading.
-->
<script lang="ts">
	import { n } from '#lib/describe/format.ts';
	import type { Attachment } from 'svelte/attachments';
	import type { LiveFeed } from '#lib/live-feed.svelte.ts';
	import Notice from './Notice.svelte';
	import PauseIcon from './icons/PauseIcon.svelte';

	interface Props {
		feed: LiveFeed<unknown>;
		/** What the list holds, for the heading and the notice: "frames", "readings", … */
		noun: string;
	}

	let { feed, noun }: Props = $props();

	let button: HTMLButtonElement | undefined;

	/**
	 * Paused while the button is above the window (scrolled past), not below it (not there
	 * yet). Checked on every scroll and resize rather than with an IntersectionObserver: that
	 * one only reports crossings, and a jump straight from below the window to above it
	 * (dragging the scrollbar, End, find in page) never crosses.
	 */
	const watchScroll: Attachment<HTMLButtonElement> = (node) => {
		button = node;
		const check = () => feed.setScrolledAway(node.getBoundingClientRect().bottom < 0);
		check();
		addEventListener('scroll', check, { passive: true });
		addEventListener('resize', check, { passive: true });
		return () => {
			removeEventListener('scroll', check);
			removeEventListener('resize', check);
			feed.setScrolledAway(false);
		};
	};
</script>

<h2 class="text-sm font-semibold text-zinc-100">
	<button
		class="group scroll-mt-6"
		title="{feed.paused ? 'Resume' : 'Pause'} the live feed"
		aria-pressed={feed.paused}
		onclick={() => feed.togglePause()}
		{@attach watchScroll}
	>
		Live {noun}<PauseIcon
			paused={feed.paused}
			class="ml-1 inline-block size-[1em] align-[-0.125em] text-zinc-500 group-hover:text-zinc-200"
		/>{#if feed.paused}<span class="ml-2 font-normal text-zinc-400">
				paused · {n(feed.held)} new</span
			>{/if}
	</button>
</h2>

{#if feed.scrolledAway && !feed.pausedByUser}
	<!-- Below the alert banner, if one is showing (the layout sets its height). -->
	<div class="fixed top-[calc(1rem+var(--alert-banner,0px))] left-1/2 z-30 -translate-x-1/2">
		<Notice tone="live">
			<button
				class="px-4 py-1.5 hover:bg-accent-900"
				onclick={() => button?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
			>
				Live {noun} paused while you scroll: {n(feed.held)} new
				<span class="ml-2 text-accent-300">↑ Back to live</span>
			</button>
		</Notice>
	</div>
{/if}
