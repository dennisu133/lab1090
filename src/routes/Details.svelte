<!--
	Sections of labelled values (lib/describe/aircraft.ts). A label with an explanation is an
	InfoTip: tappable on phones, where `title` tooltips never show. A blank line in it starts a
	new paragraph; `choices` (e.g. every emitter category) follow as a table, the one sent
	highlighted. Labels of self-explanatory values (Route, Messages) are plain text.

	The label column has one width in every section, so the values line up down the whole
	panel (sized to its content, "Selected altitude" pushed one section's values to the right).
	A section's source (adsbdb, OpenStreetMap) follows its title in its own spelling, not in
	the title's capitals.
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
			{#if section.source}
				<span class="font-normal tracking-normal text-zinc-500 normal-case">· {section.source}</span
				>
			{/if}
		</h3>
		<dl class="grid grid-cols-[8.75rem_1fr] gap-x-3 gap-y-1.5 text-sm">
			{#each section.fields as field (field.label)}
				<dt class="text-zinc-400">
					{#if field.title || field.choices}
						<InfoTip label={field.label}>
							{#each field.title?.split('\n\n') ?? [] as paragraph, i (i)}<p>{paragraph}</p>{/each}
							{#if field.choices}
								<table class="w-full text-xs">
									<tbody>
										{#each field.choices as choice (choice.key)}
											<tr class={choice.current ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'}>
												<td class="w-8 py-0.5 pl-1.5 font-mono">{choice.key}</td>
												<td class="py-0.5 pr-1.5">{choice.text}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{/if}
						</InfoTip>
					{:else}
						{field.label}
					{/if}
				</dt>
				<dd
					class={[
						'min-w-0 break-words tabular-nums',
						field.tone === 'main' && 'text-zinc-100',
						field.tone === 'minor' && 'text-zinc-400',
						field.tone === 'alert' && 'text-orange-400',
						!field.note && field.mono && 'font-mono'
					]}
				>
					{#if field.flag?.country}
						<span class="mr-1"><Flag {...field.flag} /></span>
					{/if}
					{#if field.note}
						<span class={{ 'font-mono': field.mono }}>{field.value}</span>
						<span class="text-zinc-400">· {field.note}</span>
					{:else}
						{field.value}
					{/if}
				</dd>
			{/each}
		</dl>
	</section>
{/each}
