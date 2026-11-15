<!--
	A row of decoded values (see lib/describe): bright headline values, dimmed details, orange
	for things worth noticing. Each value has a tooltip.
-->
<script lang="ts">
	import type { Field } from '#lib/describe/field.ts';

	let { fields }: { fields: Field[] } = $props();
</script>

<div class="flex flex-wrap items-baseline gap-x-3">
	{#each fields as field, i (i)}
		<span
			title={field.title}
			class={[
				'whitespace-nowrap',
				field.tone === 'main' && 'text-zinc-100',
				field.tone === 'minor' && 'text-xs text-zinc-500',
				field.tone === 'alert' && 'text-orange-400'
			]}
		>
			{#if field.label}<span class="text-xs text-zinc-500">{field.label}</span>{/if}
			<span class={{ 'font-mono': field.mono }}>{field.value}</span>
		</span>
	{/each}
</div>
