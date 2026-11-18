<!--
	A /weather card: the dark box, its title with the explanation in an InfoTip, and the
	content. With a `header` the title shares its line with it (the headline value, a count,
	a switch), on one baseline; that line wraps unless `nowrap`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import InfoTip from '#lib/components/InfoTip.svelte';

	interface Props {
		title: string;
		/** h2 for the page's own cards, h3 (default) for cards inside a section. */
		heading?: 'h2' | 'h3';
		/** The title's explanation. */
		info: Snippet;
		/** The InfoTip's options. */
		wide?: boolean;
		align?: 'left' | 'right';
		/** Next to the title, on its line. */
		header?: Snippet;
		/** Keep the title line to one line (what doesn't fit is cut off), so nothing below moves. */
		nowrap?: boolean;
		/**
		 * The space under the title (line): default mb-3 with a header, none without. Classes,
		 * e.g. 'mb-2'.
		 */
		headClass?: ClassValue;
		/** The box's own classes, e.g. a fixed height ('h-36'). */
		class?: ClassValue;
		children?: Snippet;
	}

	let {
		title,
		heading = 'h3',
		info,
		wide = false,
		align = 'left',
		header,
		nowrap = false,
		headClass,
		class: className,
		children
	}: Props = $props();

	const TITLE = 'text-sm font-semibold tracking-wide text-zinc-400 uppercase';
</script>

{#snippet titleTip(extra?: ClassValue)}
	<InfoTip {heading} class={[extra, TITLE]} label={title} {wide} {align}>
		{@render info()}
	</InfoTip>
{/snippet}

<div class={[className, 'rounded-lg bg-zinc-900 p-4']}>
	{#if header}
		<div
			class={[
				headClass ?? 'mb-3',
				'flex items-baseline',
				nowrap ? 'gap-3 whitespace-nowrap' : 'flex-wrap gap-x-3 gap-y-1'
			]}
		>
			{@render titleTip()}
			{@render header()}
		</div>
	{:else}
		{@render titleTip(headClass)}
	{/if}
	{@render children?.()}
</div>
