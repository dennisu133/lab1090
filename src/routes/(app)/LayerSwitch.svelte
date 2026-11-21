<!--
	One of MapLayers' switches: a checkbox, a small picture of what it draws (as on the map),
	and its name; with an explanation (`children`) the name is an InfoTip. `busy`: switched on
	but nothing to draw yet (an experiment still collecting), a spinner beside the name says
	it's working, so an empty map doesn't look broken.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import SpinnerIcon from '#lib/components/icons/SpinnerIcon.svelte';

	interface Props {
		checked: boolean;
		/** What the checkbox does, for screen readers: "Show the range rings". */
		label: string;
		name: string;
		/** The picture: an SVG, hidden on phones (the two boxes must fit side by side there). */
		icon: Snippet;
		/** What the layer shows, if it needs explaining. */
		children?: Snippet;
		/** A line above: the first of a group. */
		divided?: boolean;
		/** Switched on, still collecting: nothing drawn yet. */
		busy?: boolean;
	}

	let {
		checked = $bindable(),
		label,
		name,
		icon,
		children,
		divided = false,
		busy = false
	}: Props = $props();
</script>

<div class={['flex items-center gap-2', divided && 'border-t border-zinc-800 pt-1.5']}>
	<label class="flex items-center gap-2 py-0.5">
		<input type="checkbox" bind:checked class="size-3.5 accent-zinc-300" aria-label={label} />
		{@render icon()}
		{#if !children}<span>{name}</span>{/if}
	</label>
	{#if children}
		<InfoTip label={name}>{@render children()}</InfoTip>
	{/if}
	<!-- A live region from the start, so screen readers hear it when the spinner comes and goes. -->
	<span role="status" class="ml-auto flex text-zinc-300">
		{#if busy}<SpinnerIcon /><span class="sr-only">{name}: collecting</span>{/if}
	</span>
</div>
