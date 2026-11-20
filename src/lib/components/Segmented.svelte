<!--
	A choice of a few options side by side, "All / Broadcast / Interrogated": the data pages'
	view switches. Plain text like the table headers, no background: the chosen option is
	bright, the others are dim until hovered.
-->
<script lang="ts" generics="T">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		options: { value: T; label: string }[];
		value: T;
		/** A name in front of the options, "profile winds", when the context doesn't give one. */
		prefix?: string;
		/** Inside a sentence: at the sentence's size, not the table headers'. */
		inline?: boolean;
		class?: ClassValue;
	}

	let { options, value = $bindable(), prefix, inline = false, class: className }: Props = $props();
</script>

<span class={['inline-flex items-baseline gap-1.5', !inline && 'text-xs', className]} role="group">
	{#if prefix}<span class="text-zinc-500">{prefix}:</span>{/if}
	{#each options as o, i (o.label)}
		{#if i > 0}<span class="text-zinc-700" aria-hidden="true">/</span>{/if}
		<button
			class={value === o.value ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}
			aria-pressed={value === o.value}
			onclick={() => (value = o.value)}
		>
			{o.label}
		</button>
	{/each}
</span>
