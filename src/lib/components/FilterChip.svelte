<!--
	A filter the list is narrowed to, "BDS 4,0 only ✕": the data pages' feeds (/frames,
	/comm-b) set one when you pick a row of their tables. A click removes it.
-->
<script lang="ts">
	interface Props {
		/** What the list is narrowed to: "DF17", "BDS 4,0", an address. */
		label: string;
		onclear: () => void;
	}

	let { label, onclear }: Props = $props();
</script>

<button class="rounded bg-sky-900 px-3 py-1 text-sm hover:bg-sky-800" onclick={onclear}>
	{label} only ✕
</button>
