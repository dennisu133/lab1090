import { expect, test } from 'bun:test';
import { LAYER_IDS, mapLayers, SOURCES } from './layers.ts';
import { PICKABLE } from './pick.ts';
import { mapStyle } from './style.ts';

const ours = mapLayers();
const base = mapStyle().layers.map((l) => l.id);

test('every layer of ours draws one of our sources, and has its own id', () => {
	for (const layer of ours) {
		expect(layer.type === 'background' ? null : layer.source).toBeOneOf([...SOURCES]);
		expect(base).not.toContain(layer.id);
	}
	expect(new Set(ours.map((l) => l.id)).size).toBe(ours.length);
});

test('every source of ours is drawn by some layer', () => {
	const drawn = new Set(ours.map((l) => ('source' in l ? l.source : null)));
	for (const id of SOURCES) expect(drawn.has(id)).toBe(true);
});

test('the switches, the taps and TrackerMap name real layers', () => {
	const all = new Set([...ours.map((l) => l.id), ...base]);
	const named = [
		...Object.values(LAYER_IDS).flat(),
		...PICKABLE,
		// Restyled by TrackerMap's effects (selection, radar, barbs near the selected level).
		...['selected', 'trails', 'heads', 'prediction', 'aircraft', 'winds', 'receiver-selected']
	];
	for (const id of named) expect(all.has(id) ? id : `missing: ${id}`).toBe(id);
});
