<!--
	The static demo's notice (DEMO): what it shows is a recording, not the sky right now. In
	the alert banner's place and shape (AlertBanner.svelte), floating on every page so it
	takes no room; an alert, if the recording has one, goes first. The cross hides it for
	good (remembered in localStorage).

	Shown only once the page runs (the stored choice is only known there): floating, it moves
	nothing when it appears.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import CloseIcon from '#lib/components/icons/CloseIcon.svelte';
	import Notice from '#lib/components/Notice.svelte';
	import { date } from '#lib/describe/format.ts';
	import { receiverLink } from '#lib/receiver-link.svelte.ts';
	import { repository } from '../../../package.json';

	/** Whether it shows (the layout moves other floating notices below it). */
	let { open = $bindable(false), hidden }: { open?: boolean; hidden: boolean } = $props();

	const KEY = 'demo.notice';
	/** The project's page: package.json's repository, without git's "git+" and ".git". */
	const PROJECT = repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

	let recordedAt = $derived(receiverLink.replay?.recordedAt ?? null);
	/** Until the page runs, as if closed: the server can't know. */
	let closed = $state(true);
	onMount(() => {
		closed = localStorage.getItem(KEY) === 'closed';
	});
	$effect(() => {
		open = !closed && !hidden && recordedAt !== null;
	});

	function close() {
		closed = true;
		localStorage.setItem(KEY, 'closed');
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- its one link is to another site -->
{#if open && recordedAt !== null}
	<div class="sticky top-0 z-30 flex h-0 justify-center">
		<div class="mt-3">
			<Notice tone="live">
				<!-- Shorter on a phone, to fit next to the link (the date is in the bar above). -->
				<p class="min-w-0 truncate py-1.5 pr-2 pl-4">
					<span class="sm:hidden">Not live: a recording</span>
					<span class="max-sm:hidden">
						Not live: recorded {date(recordedAt)}, replayed in a loop
					</span>
				</p>
				<a
					href={PROJECT}
					target="_blank"
					rel="noreferrer"
					class="shrink-0 py-1.5 pr-2 text-accent-300 hover:text-accent-200">Get lab1090</a
				>
				<button
					type="button"
					class="grid shrink-0 place-items-center pr-3 pl-2.5 text-accent-300 hover:bg-accent-900"
					aria-label="Hide this notice"
					onclick={close}><CloseIcon /></button
				>
			</Notice>
		</div>
	</div>
{/if}
