import { describe, expect, test } from 'bun:test';
import type { ResolutionAdvisory } from '#lib/modes/acas.ts';
import { advisoryFields } from './field';

/** No advisory; each test sets the ARA/RAC/RAT/MTE bits it needs (Annex 10 Vol IV, the ARA field). */
const none: ResolutionAdvisory = {
	active: false,
	corrective: false,
	downward: false,
	increasedRate: false,
	senseReversal: false,
	altitudeCrossing: false,
	positive: false,
	noBelow: false,
	noAbove: false,
	noLeft: false,
	noRight: false,
	terminated: false,
	multipleThreats: false,
	threat: null
};

const ra = (bits: Partial<ResolutionAdvisory>) => advisoryFields({ ...none, ...bits })[0];

describe('advisoryFields', () => {
	test('no bits: no RA', () => {
		expect(ra({}).value).toBe('no RA');
	});

	test('one threat (bit 9): corrective climb, preventive "don’t climb"', () => {
		const climb = ra({ active: true, corrective: true, positive: true });
		expect(climb.value).toBe('RA: climb');
		expect(climb.title).toContain('corrective');
		// A positive climb or descent is corrective even without bit 10.
		expect(ra({ active: true, positive: true, senseReversal: true }).title).toContain('corrective');
		const limit = ra({ active: true, downward: true });
		expect(limit.value).toBe('RA: don’t climb');
		expect(limit.title).toContain('preventive');
	});

	test('several threats (bit 9 clear, MTE set) are an RA too, read with the multi-threat meanings', () => {
		// Bit 11 is "positive climb" here (splitAdvisory), not the one-threat "downward sense".
		const climb = ra({ multipleThreats: true, downward: true });
		expect(climb.value).toBe('RA: climb (several threats)');
		expect(climb.title).toContain('corrective');
		// Bit 10 alone: a correction upward, i.e. a limit on descending.
		const limit = ra({ multipleThreats: true, corrective: true });
		expect(limit.value).toBe('RA: don’t descend (several threats)');
		expect(limit.title).toContain('preventive');
	});

	test('RAT set: ended, whatever the other bits say', () => {
		expect(ra({ terminated: true, active: true, corrective: true }).value).toBe('RA ended');
		expect(ra({ terminated: true, multipleThreats: true }).value).toBe('RA ended');
	});
});
