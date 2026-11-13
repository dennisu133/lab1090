<!--
	A label with an explanation that appears on hover (mouse) or focus (keyboard, tap).
	Pure CSS: the tooltip lives inside the same `group`, so moving the pointer onto it keeps it open.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The visible text that gets the tooltip. */
		label: string;
		/** Which edge the tooltip lines up with; use 'right' near the right side of the page. */
		align?: 'left' | 'right';
		children: Snippet;
	}

	let { label, align = 'left', children }: Props = $props();

	const id = $props.id();
</script>

<span class="group relative inline-block">
	<button
		type="button"
		aria-describedby={id}
		class="cursor-help underline decoration-zinc-600 decoration-dotted underline-offset-4 group-hover:text-zinc-200"
	>
		{label}<span aria-hidden="true" class="ml-1 text-zinc-500">ⓘ</span>
	</button>
	<div
		{id}
		role="tooltip"
		class={[
			'invisible absolute top-full z-20 w-96 pt-2 opacity-0 transition-opacity',
			'group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
			align === 'left' ? 'left-0' : 'right-0'
		]}
	>
		<div
			class="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-left text-sm leading-relaxed font-normal tracking-normal text-zinc-300 normal-case shadow-xl"
		>
			{@render children()}
		</div>
	</div>
</span>
