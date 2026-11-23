<!--
	"● Rec 4:12" in the navigation bar while the server records the samples (--record): the time
	left. Gone once the file is saved; /receiver's Device card says how it ended.
-->
<script lang="ts">
	import { bytesText, clockTime, minutesSeconds } from '#lib/describe/format.ts';
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { receiverLink as link } from '#lib/receiver-link.svelte.ts';

	let recording = $derived(link.recording);
	let active = $derived(
		link.online !== false &&
			(recording?.state === 'waiting' ||
				recording?.state === 'recording' ||
				recording?.state === 'finishing')
	);
	let left = $derived(recording ? recording.plannedMs - recording.ms : 0);
</script>

{#if active && recording}
	<div class="flex shrink-0 items-center gap-2 text-xs/4 whitespace-nowrap tabular-nums">
		<span
			class={[
				'size-2.5 rounded-full bg-red-500',
				recording.state === 'recording' && 'motion-safe:animate-pulse'
			]}
		></span>
		<InfoTip
			label={recording.state === 'finishing' ? 'Saving…' : `Rec ${minutesSeconds(left)}`}
			class="text-zinc-300"
			align="right"
		>
			<p>
				The server is saving the RTL-SDR's raw samples to <span class="font-mono"
					>{recording.file}</span
				>, in the directory lab1090 was started in:
				{#if recording.state === 'waiting'}
					from the first samples on, which haven't come yet.
				{:else}
					{bytesText(recording.bytes)} so far, until about {clockTime(Date.now() + left)}.
				{/if}
			</p>
		</InfoTip>
	</div>
{/if}
