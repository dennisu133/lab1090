<!--
	One of MapLayers' switches: a checkbox, a small picture of what it draws (as on the map),
	and its name; with an explanation (`children`) the name is an InfoTip.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';

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
	}

	let { checked = $bindable(), label, name, icon, children, divided = false }: Props = $props();
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
</div>
