<!--
	A label with an explanation that appears on hover (mouse) or focus (keyboard, tap).
	Pure CSS: the tooltip lives inside the same `group`, so moving the pointer onto it keeps it open.

	For a section title, pass `heading="h2"`: only the label goes inside the heading, the
	tooltip sits next to it (a heading may only contain text, not paragraphs or tables).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** The visible text that gets the tooltip. */
		label: string;
		/** Wrap the label in a heading element. */
		heading?: 'h2' | 'h3';
		/** Classes for the label (or heading). */
		class?: ClassValue;
		/** Which edge the tooltip lines up with; use 'right' near the right side of the page. */
		align?: 'left' | 'right';
		/** Room for longer explanations, e.g. with a table. */
		wide?: boolean;
		children: Snippet;
	}

	let {
		label,
		heading,
		class: labelClass,
		align = 'left',
		wide = false,
		children
	}: Props = $props();

	const id = $props.id();
</script>

<div class="group relative inline-block">
	<svelte:element this={heading ?? 'span'} class={labelClass}>
		<button
			type="button"
			aria-describedby={id}
			class="cursor-help [text-transform:inherit] underline decoration-zinc-600 decoration-dotted underline-offset-4 group-hover:text-zinc-200"
		>
			{label}<span aria-hidden="true" class="ml-1 text-zinc-500">ⓘ</span>
		</button>
	</svelte:element>
	<div
		{id}
		role="tooltip"
		class={[
			'invisible absolute top-full z-20 pt-2 opacity-0 transition-opacity',
			'group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
			wide ? 'w-[40rem]' : 'w-96',
			align === 'left' ? 'left-0' : 'right-0'
		]}
	>
		<div
			class="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-left text-sm leading-relaxed font-normal tracking-normal text-zinc-300 normal-case shadow-xl"
		>
			{@render children()}
		</div>
	</div>
</div>
