<!--
	A photo of the selected airframe, from airport-data.com via adsbdb (lib/aircraft-db.ts): a
	short banner under the panel's header. The full-size photo, cropped to the middle: the
	150 px thumbnail is too blurry at panel width, and only the selected aircraft's loads.
	The crop cuts off the credit printed along the photo's bottom edge, so the photo and the
	caption link to its page on airport-data.com, which names the photographer.
-->
<script lang="ts">
	import type { DbPhoto } from '#lib/aircraft-db.ts';

	let { photo, registration }: { photo: DbPhoto; registration: string } = $props();

	/** A broken link (removed photo) hides the banner instead of showing an empty box. */
	let failed = $state(false);
</script>

{#if !failed}
	<figure class="px-4 pb-3">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- another site, not a route -->
		<a href={photo.page ?? photo.url} target="_blank" class="block">
			<img
				src={photo.url}
				alt="Photo of {registration || 'this aircraft'}"
				onerror={() => (failed = true)}
				class="aspect-12/5 w-full rounded-md bg-zinc-900 object-cover"
			/>
		</a>
		<figcaption class="mt-1 text-xs text-zinc-500">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- another site, not a route -->
			<a href={photo.page ?? photo.url} target="_blank" class="hover:text-zinc-300 hover:underline"
				>Photo: airport-data.com</a
			>
		</figcaption>
	</figure>
{/if}
