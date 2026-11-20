<!--
	A filter the list is narrowed to, "BDS 4,0 only ✕": the data pages' feeds (/frames,
	/comm-b, /weather/aircraft) set one when you pick a row of their tables. A click removes it.
-->
<script lang="ts">
	import CloseIcon from './icons/CloseIcon.svelte';

	interface Props {
		/** What the list is narrowed to: "DF17", "BDS 4,0", an address. */
		label: string;
		onclear: () => void;
	}

	let { label, onclear }: Props = $props();
</script>

<!-- Plain text like the view switch next to it; the colour says the list is narrowed, "only"
     and the cross say it without colour too. -->
<button
	class="flex items-center gap-1 text-xs text-accent-400 hover:text-accent-200"
	onclick={onclear}
>
	{label} only <CloseIcon class="size-3" />
</button>
