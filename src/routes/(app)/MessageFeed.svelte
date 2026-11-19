<!--
	The selected aircraft's latest messages, newest first: what the tracker's values are made
	of. Each row opens to show every decoded field with its explanation (a tap, not a hover:
	this works on phones too). /frames has the full view of every message.

	A nearby aircraft sends ~10 messages a second, so the list turns over in seconds. While a
	message is open, the list holds still (like /frames when scrolled into), so it can be read.
-->
<script lang="ts">
	import { clockTime, dbfs } from '#lib/describe/format.ts';
	import type { Message } from './tracker-stream.svelte.ts';

	let { messages }: { messages: Message[] } = $props();

	/** The list as it was when a message was opened; null: live. */
	let frozen = $state.raw<Message[] | null>(null);
	/** Which messages are open (their ids). */
	let open = $state.raw<number[]>([]);

	let shown = $derived(frozen ?? messages);
	/** Arrived since the list froze. */
	let waiting = $derived(frozen ? messages.filter((m) => m.id > (frozen![0]?.id ?? 0)).length : 0);

	function toggle(id: number, isOpen: boolean) {
		open = isOpen ? [...open, id] : open.filter((o) => o !== id);
		if (isOpen) frozen ??= messages;
		else if (open.length === 0) frozen = null;
	}
</script>

<section class="border-t border-zinc-800 px-4 py-3">
	<h3 class="mb-2 text-xs font-medium text-zinc-400">Live messages</h3>
	{#if frozen}
		<p class="mb-2 text-xs text-amber-300">
			Paused while a message is open{waiting ? ` · ${waiting} new` : ''}
		</p>
	{/if}
	<ol class="space-y-1 text-xs">
		{#each shown as m (m.id)}
			<li>
				<details
					class="group rounded bg-zinc-900/60"
					ontoggle={(e) => toggle(m.id, e.currentTarget.open)}
				>
					<summary class="flex items-baseline gap-2 px-2 py-1 select-none">
						<span class="text-zinc-500 tabular-nums">{clockTime(m.rx)}</span>
						<span class="font-mono text-zinc-300">{m.kind}</span>
						<span class="min-w-0 truncate text-zinc-400">
							{m.fields
								.filter((f) => f.tone === 'main')
								.map((f) => (f.label ? `${f.label} ${f.value}` : f.value))
								.join(' · ')}
						</span>
					</summary>
					<div class="space-y-1.5 px-2 pt-1 pb-2">
						<p class="text-zinc-500">{m.title} · {dbfs(m.dbfs)}</p>
						{#each m.fields as f, i (i)}
							<p>
								<span class={f.tone === 'alert' ? 'text-orange-400' : 'text-zinc-200'}>
									{f.label ? `${f.label} ` : ''}<span class={{ 'font-mono': f.mono }}
										>{f.value}</span
									>
								</span>
								<span class="text-zinc-500">: {f.title}</span>
							</p>
						{/each}
					</div>
				</details>
			</li>
		{:else}
			<li class="text-zinc-500">None in the last minute.</li>
		{/each}
	</ol>
</section>
