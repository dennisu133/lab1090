<!--
	The flag of the State an aircraft is registered in (the address block's State,
	modes/nationality.ts). SVGs from flag-icons (MIT License, Copyright (c) 2013 Panayiotis
	Lipiridis), 4:3. Without a country (ICAO blocks, unallocated addresses) it keeps its
	space, so names next to it stay aligned.
-->
<script lang="ts" module>
	// Every flag becomes its own file in the build (no-inline: not as data URLs in the
	// bundle); the browser fetches only the ones it shows.
	const FLAGS = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', {
		query: '?no-inline',
		import: 'default',
		eager: true
	});

	/** The flag's URL for an ISO 3166-1 alpha-2 code ("de"); null if there's none. */
	export function flagUrl(country: string): string | null {
		return FLAGS[`/node_modules/flag-icons/flags/4x3/${country}.svg`] ?? null;
	}
</script>

<script lang="ts">
	interface Props {
		/** ISO 3166-1 alpha-2, lower case. */
		country: string | null;
		/** The State's name, for screen readers. */
		name: string;
	}

	let { country, name }: Props = $props();

	let src = $derived(country ? flagUrl(country) : null);
</script>

{#if src}
	<!-- A thin ring so white and dark flags (Japan, Germany) keep their edge on zinc. -->
	<img
		{src}
		alt={name}
		class="inline-block h-3 w-4 shrink-0 rounded-xs object-cover opacity-90 ring-1 ring-white/15"
	/>
{:else}
	<span class="inline-block h-3 w-4 shrink-0" aria-hidden="true"></span>
{/if}
