<!--
	The two links between the antenna and this page: browser ↔ server (the event stream) and
	server ↔ Pi (the Beast connection).
-->
<script lang="ts">
	import type { RawUpdate } from '#lib/receiver-types.ts';

	let { online, update }: { online: boolean; update: RawUpdate | null } = $props();

	let status = $derived(update?.status);
</script>

<div class="flex items-center gap-2">
	{#if !online}
		<span class="size-2.5 rounded-full bg-zinc-500"></span>
		<span>Server stream offline, retrying…</span>
	{:else if status?.state === 'connected'}
		<span class="size-2.5 animate-pulse rounded-full bg-emerald-400"></span>
		<span>Receiving from <code class="text-zinc-300">{update?.source}</code></span>
	{:else if status?.state === 'waiting'}
		<span class="size-2.5 rounded-full bg-amber-400"></span>
		<span>
			Receiver unreachable ({status.reason}), retrying in {(status.retryInMs / 1000).toFixed(0)} s
		</span>
	{:else}
		<span class="size-2.5 rounded-full bg-amber-400"></span>
		<span>Connecting to <code>{update?.source ?? 'receiver'}</code>…</span>
	{/if}
</div>
