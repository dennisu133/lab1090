<script lang="ts" module>
	export type Part = 'header' | 'address' | 'payload' | 'parity';

	/**
	 * Split a message (hex) into its fields, as hex-character ranges:
	 *   DF11:       DF·CA (8 bit) | AA address (24) | PI parity (24)
	 *   DF17/18:    DF·CA (8 bit) | AA address (24) | ME payload (56) | PI parity (24)
	 *   other short: DF + control fields (32 bit) | AP address/parity (24)
	 *   other long:  DF + control fields (32 bit) | MV/MB payload (56) | AP address/parity (24)
	 */
	export function split(hex: string, df: number): { part: Part; text: string }[] {
		const cut = (ranges: [Part, number, number][]) =>
			ranges.map(([part, from, to]) => ({ part, text: hex.slice(from, to) }));
		if (df === 11)
			return cut([
				['header', 0, 2],
				['address', 2, 8],
				['parity', 8, 14]
			]);
		if (df === 17 || df === 18)
			return cut([
				['header', 0, 2],
				['address', 2, 8],
				['payload', 8, 22],
				['parity', 22, 28]
			]);
		if (hex.length === 14)
			return cut([
				['header', 0, 8],
				['parity', 8, 14]
			]);
		return cut([
			['header', 0, 8],
			['payload', 8, 22],
			['parity', 22, 28]
		]);
	}

	export const PART_COLORS: Record<Part, string> = {
		header: 'text-zinc-400',
		address: 'text-amber-300',
		payload: 'text-sky-300',
		parity: 'text-rose-400/80'
	};
</script>

<script lang="ts">
	let { hex, df }: { hex: string; df: number } = $props();
</script>

<span class="font-mono">
	{#each split(hex, df) as { part, text } (part)}
		<span class={PART_COLORS[part]}>{text}</span>
	{/each}
</span>
