import { expect, test } from 'bun:test';
import { BaseMapHealth, GRACE_MS } from './base-map';

test('one failed tile among loading ones is no alarm', () => {
	const h = new BaseMapHealth();
	h.loaded(0);
	h.error(100);
	h.loaded(400); // the others keep coming
	expect(h.unreachable(100 + GRACE_MS)).toBe(false);
});

test('an error, then nothing for the grace period: unreachable', () => {
	const h = new BaseMapHealth();
	h.error(100);
	expect(h.unreachable(100 + GRACE_MS - 1)).toBe(false);
	expect(h.unreachable(100 + GRACE_MS)).toBe(true);
});

test('the first tile that loads clears it', () => {
	const h = new BaseMapHealth();
	h.loaded(0);
	h.error(1000);
	expect(h.unreachable(1000 + GRACE_MS)).toBe(true);
	h.loaded(9000);
	expect(h.unreachable(9000)).toBe(false);
});

test('nothing happened yet: not unreachable', () => {
	expect(new BaseMapHealth().unreachable(1e6)).toBe(false);
});
