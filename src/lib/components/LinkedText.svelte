<!--
	A paragraph of explanation from lib/describe, where a link is written `[text](target)`:
	another page of the app (`/frames`, `/weather/aircraft?icao=3C6444`: the path must be one
	of PAGES, a query and a #fragment may follow) or a source on the web (`https://…`, opens in
	a new tab).
	Anything else in brackets stays text as written.
-->
<script lang="ts">
	import { resolve } from '$app/paths';

	let { text }: { text: string } = $props();

	/** The pages a tooltip may send the reader to, for more on what it only touches on. */
	const PAGES: Record<string, string> = {
		'/frames': resolve('/(app)/frames'),
		'/comm-b': resolve('/(app)/comm-b'),
		'/weather': resolve('/(app)/weather'),
		'/weather/aircraft': resolve('/(app)/weather/aircraft'),
		'/receiver': resolve('/(app)/receiver')
	};

	const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

	type Part = { text: string; href?: string; external?: boolean };

	let parts = $derived.by(() => {
		const out: Part[] = [];
		let at = 0;
		for (const m of text.matchAll(LINK)) {
			const [whole, label, target] = m;
			const path = target.split(/[?#]/)[0];
			const page = PAGES[path];
			const external = /^https:\/\//.test(target);
			if (!page && !external) continue;
			out.push({ text: text.slice(at, m.index) });
			out.push({
				text: label,
				href: external ? target : page + target.slice(path.length),
				external
			});
			at = m.index + whole.length;
		}
		out.push({ text: text.slice(at) });
		return out;
	});
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- the app's pages are resolved in PAGES, the rest are other sites -->
{#each parts as part, i (i)}{#if part.href === undefined}{part.text}{:else if part.external}<a
			href={part.href}
			target="_blank"
			rel="noreferrer"
			class="text-accent-400 hover:text-accent-300">{part.text}</a
		>{:else}<a href={part.href} class="text-accent-400 hover:text-accent-300">{part.text}</a
		>{/if}{/each}
