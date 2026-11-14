<!--
	The tracker (planned). Unlike the data pages (/frames, /comm-b: 1024 px and up), this
	page is meant to work on phones too, down to 360 px: design it mobile-first.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<h1 class="mb-2 text-2xl font-semibold">ADS-B receiver</h1>
<p class="text-zinc-400">
	Live Mode S and ADS-B traffic from the receiver. Start with the
	<a href={resolve('/frames')} class="text-sky-400 underline">raw frames</a>.
</p>
