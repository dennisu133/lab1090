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

<button
	class="flex items-center gap-1.5 rounded bg-accent-900 py-1 pr-2 pl-3 text-sm hover:bg-accent-800"
	onclick={onclear}
>
	{label} only <CloseIcon class="size-3.5" />
</button>
