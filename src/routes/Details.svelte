<!--
	Sections of labelled values (lib/describe/aircraft.ts). Every label is an InfoTip with the
	explanation: tappable on phones, where `title` tooltips never show.
-->
<script lang="ts">
	import Flag from '#lib/components/Flag.svelte';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import type { Section } from '#lib/describe/aircraft.ts';

	let { sections }: { sections: Section[] } = $props();
</script>

{#each sections as section (section.title)}
	<section class="border-t border-zinc-800 px-4 py-3">
		<h3
			class={[
				'mb-2 text-xs font-semibold tracking-wide uppercase',
				section.tier === 'emergency'
					? 'text-red-400'
					: section.tier === 'caution'
						? 'text-amber-300'
						: 'text-zinc-500'
			]}
		>
			{section.title}
		</h3>
		<dl class="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
			{#each section.fields as field (field.label)}
				<dt class="text-zinc-400">
					<InfoTip label={field.label}><p>{field.title}</p></InfoTip>
				</dt>
				<dd
					class={[
						'min-w-0 break-words tabular-nums',
						field.tone === 'main' && 'text-zinc-100',
						field.tone === 'minor' && 'text-zinc-400',
						field.tone === 'alert' && 'text-orange-400',
						field.mono && 'font-mono'
					]}
				>
					{#if field.flag?.country}
						<span class="mr-1"><Flag {...field.flag} /></span>
					{/if}
					{field.value}
				</dd>
			{/each}
		</dl>
	</section>
{/each}
