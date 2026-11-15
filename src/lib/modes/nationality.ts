/**
 * Where an aircraft is registered, from nothing but its 24-bit address, and what its
 * registration must therefore start with.
 *
 * ICAO hands out the 16.7 million addresses in blocks, one or more per State (Annex 10,
 * Vol. III, Part I, Chapter 9, Table 9-1, generated into address-blocks.ts). The State of
 * Registry then gives each aircraft on its register an address from its block, for good: it
 * stays with the airframe, whatever airline flies it. So 3C6586 is German because
 * 3C0000–3FFFFF is Germany's block.
 *
 * The registration ("tail number") starts with the State's nationality mark (Annex 7):
 * letters or digits taken from the radio call sign series the ITU allocated to it. Germany
 * has D, so German aircraft are D-AIZA, D-EFGH, ... Most States write a dash after the mark;
 * a few don't (N12345 in the US, JA8089 in Japan, HL7xxx in Korea). Some have several marks
 * (Poland SP and SN), and one block can hold more than one register: the UK's also serves
 * the Isle of Man (M-), Guernsey (2-) and the Overseas Territories (VP-, VQ-, e.g. Bermuda).
 *
 * The marks below are from jet1090's data/patterns.json (MIT License, Copyright (c) 2024
 * Xavier Olive), matched to the Annex 10 blocks by address range, and completed by hand:
 * Andorra, Dominica, Saint Kitts and Nevis, South Sudan, Timor-Leste and Tuvalu (missing
 * there) and the UK's other registers. Comm-B register 2,1 is checked against them
 * (comm-b.ts): a registration that doesn't start with the mark of its address's State is
 * random bits, not a registration.
 *
 * Shared by server and browser; no state here.
 */
import { ADDRESS_BLOCKS } from './address-blocks';
import { COUNTRY_CODES } from './country-codes';

export interface Allocation {
	/** As Table 9-1 names it, e.g. "Germany", "Iran (Islamic Republic of)". */
	state: string;
	/** The block, hex. */
	from: string;
	to: string;
	/** Addresses in the block: 2,048 to 1,048,576. */
	size: number;
	/** Nationality marks, with a trailing '-' where the State writes a dash. Empty: unknown. */
	marks: readonly string[];
	/** ISO 3166-1 alpha-2, lower case ("de"), for the flag; null for the ICAO blocks. */
	country: string | null;
}

/**
 * Nationality marks per State (the names are Table 9-1's). A trailing '-' means the
 * registration is written with a dash after the mark.
 */
export const NATIONALITY_MARKS: Readonly<Record<string, readonly string[]>> = {
	Afghanistan: ['YA-'],
	Albania: ['ZA-'],
	Algeria: ['7T-'],
	Andorra: ['C3-'],
	Angola: ['D2-'],
	'Antigua and Barbuda': ['V2-'],
	Argentina: ['LV-', 'LQ-'],
	Armenia: ['EK-'],
	Australia: ['VH-'],
	Austria: ['OE-'],
	Azerbaijan: ['4K-'],
	Bahamas: ['C6-'],
	Bahrain: ['A9C-'],
	Bangladesh: ['S2-', 'S3-'],
	Barbados: ['8P-'],
	Belarus: ['EW-'],
	Belgium: ['OO-'],
	Belize: ['V3-'],
	Benin: ['TY-'],
	Bhutan: ['A5-'],
	'Bolivia (Plurinational State of)': ['CP-'],
	'Bosnia and Herzegovina': ['E7-', 'T9-'],
	Botswana: ['A2-'],
	Brazil: ['PP-', 'PR-', 'PS-', 'PT-', 'PU-'],
	'Brunei Darussalam': ['V8-'],
	Bulgaria: ['LZ-'],
	'Burkina Faso': ['XT-'],
	Burundi: ['9U-'],
	'Cabo Verde': ['D4-'],
	Cambodia: ['XU-'],
	Cameroon: ['TJ-'],
	Canada: ['C-'], // C-F… and C-G…
	'Central African Republic': ['TL-'],
	Chad: ['TT-'],
	Chile: ['CC-'],
	China: ['B-'], // also Hong Kong (B-H, B-K, B-L) and Macao (B-M)
	Colombia: ['HJ-', 'HK-'],
	Comoros: ['D6-'],
	Congo: ['TN-'],
	'Cook Islands': ['E5-'],
	'Costa Rica': ['TI-'],
	'Côte d’Ivoire': ['TU-'],
	Croatia: ['9A-'],
	Cuba: ['CU-'],
	Cyprus: ['5B-'],
	Czechia: ['OK-'],
	'Democratic People’s Republic of Korea': ['P-'],
	'Democratic Republic of the Congo': ['9O-', '9Q-', '9S-', '9T-'],
	Denmark: ['OY-'],
	Djibouti: ['J2-'],
	Dominica: ['J7-'],
	'Dominican Republic': ['HI'],
	Ecuador: ['HC-'],
	Egypt: ['SU-'],
	'El Salvador': ['YS-'],
	'Equatorial Guinea': ['3C-'],
	Eritrea: ['E3-'],
	Estonia: ['ES-'],
	Eswatini: ['3DC-'],
	Ethiopia: ['ET-'],
	Fiji: ['DQ-'],
	Finland: ['OH-'],
	France: ['F-'],
	Gabon: ['TR-'],
	Gambia: ['C5-'],
	Georgia: ['4L-'],
	Germany: ['D-'],
	Ghana: ['9G-'],
	Greece: ['SX-'],
	Grenada: ['J3-'],
	Guatemala: ['TG-'],
	Guinea: ['3X-'],
	'Guinea-Bissau': ['J5-'],
	Guyana: ['8R-'],
	Haiti: ['HH'],
	Honduras: ['HR-'],
	Hungary: ['HA-'],
	Iceland: ['TF-'],
	India: ['VT-'],
	Indonesia: ['PK-'],
	'Iran (Islamic Republic of)': ['EP-'],
	Iraq: ['YI-'],
	Ireland: ['EI-', 'EJ-'],
	Israel: ['4X-'],
	Italy: ['I-'],
	Jamaica: ['6Y-'],
	Japan: ['JA'],
	Jordan: ['JY-'],
	Kazakhstan: ['UP-'],
	Kenya: ['5Y-'],
	Kiribati: ['T3-'],
	Kuwait: ['9K-'],
	Kyrgyzstan: ['EX-'],
	'Lao People’s Democratic Republic': ['RDPL-'],
	Latvia: ['YL-'],
	Lebanon: ['OD-'],
	Lesotho: ['7P-'],
	Liberia: ['A8-'],
	Libya: ['5A-'],
	Lithuania: ['LY-'],
	Luxembourg: ['LX-'],
	Madagascar: ['5R-'],
	Malawi: ['7Q-'],
	Malaysia: ['9M-'],
	Maldives: ['8Q-'],
	Mali: ['TZ-'],
	Malta: ['9H-'],
	'Marshall Islands': ['V7-'],
	Mauritania: ['5T-'],
	Mauritius: ['3B-'],
	Mexico: ['XA-', 'XB-', 'XC-'],
	'Micronesia (Federated States of)': ['V6-'],
	Monaco: ['3A-'],
	Mongolia: ['JU-'],
	Montenegro: ['4O-'],
	Morocco: ['CN-'],
	Mozambique: ['C9-'],
	Myanmar: ['XY-', 'XZ-'],
	Namibia: ['V5-'],
	Nauru: ['C2-'],
	Nepal: ['9N-'],
	Netherlands: ['PH-'],
	'New Zealand': ['ZK-', 'ZL-', 'ZM-'],
	Nicaragua: ['YN-'],
	Niger: ['5U-'],
	Nigeria: ['5N-'],
	'North Macedonia': ['Z3-'],
	Norway: ['LN-'],
	Oman: ['A4O-'],
	Pakistan: ['AP-'],
	Palau: ['T8-'],
	Panama: ['HP-'],
	'Papua New Guinea': ['P2-'],
	Paraguay: ['ZP-'],
	Peru: ['OB-'],
	Philippines: ['RP-'],
	Poland: ['SP-', 'SN-'],
	Portugal: ['CR-', 'CS-'],
	Qatar: ['A7-'],
	'Republic of Korea': ['HL'],
	'Republic of Moldova': ['ER-'],
	Romania: ['YR-'],
	'Russian Federation': ['RA-', 'RF-'],
	Rwanda: ['9XR-'],
	'Saint Kitts and Nevis': ['V4-'],
	'Saint Lucia': ['J6-'],
	'Saint Vincent and the Grenadines': ['J8-'],
	Samoa: ['5W-'],
	'San Marino': ['T7-'],
	'Sao Tome and Principe': ['S9-'],
	'Saudi Arabia': ['HZ-'],
	Senegal: ['6V-', '6W-'],
	Serbia: ['YU-'],
	Seychelles: ['S7-'],
	'Sierra Leone': ['9L-'],
	Singapore: ['9V-'],
	Slovakia: ['OM-'],
	Slovenia: ['S5-'],
	'Solomon Islands': ['H4-'],
	Somalia: ['6O-'],
	'South Africa': ['ZS-', 'ZT-', 'ZU-'],
	'South Sudan': ['Z8-'],
	Spain: ['EC-', 'EM-'],
	'Sri Lanka': ['4R-'],
	Sudan: ['ST-'],
	Suriname: ['PZ-'],
	Sweden: ['SE-'],
	Switzerland: ['HB-'],
	'Syrian Arab Republic': ['YK-'],
	Tajikistan: ['EY-'],
	Thailand: ['HS-'],
	'Timor-Leste': ['4W-'],
	Togo: ['5V-'],
	Tonga: ['A3-'],
	'Trinidad and Tobago': ['9Y-'],
	Tunisia: ['TS-'],
	Türkiye: ['TC-'],
	Turkmenistan: ['EZ-'],
	Tuvalu: ['T2-'],
	Uganda: ['5X-'],
	Ukraine: ['UR-'],
	'United Arab Emirates': ['A6-'],
	// The Isle of Man, Guernsey and the Overseas Territories register from the UK's block.
	'United Kingdom': ['G-', 'M-', '2-', 'VP-', 'VQ-'],
	'United Republic of Tanzania': ['5H-'],
	'United States': ['N'],
	Uruguay: ['CX-'],
	Uzbekistan: ['UK'],
	Vanuatu: ['YJ-'],
	'Venezuela (Bolivarian Republic of)': ['YV'],
	'Viet Nam': ['VN-'],
	Yemen: ['7O-'],
	Zambia: ['9J-'],
	Zimbabwe: ['Z-']
};

/**
 * Blocks whose marks don't follow from the State's name. Table 9-1 lists 899000–8997FF as
 * an ICAO block "for special use in the interest of flight safety"; the aircraft on
 * Taiwan's register (B-) use it.
 */
const BLOCK_MARKS: Readonly<Record<string, readonly string[]>> = { '899000': ['B-'] };

const BLOCKS = ADDRESS_BLOCKS.map(([from, to, state]) => ({
	from,
	to,
	state,
	start: parseInt(from, 16),
	end: parseInt(to, 16)
}));

/** The block an address is in, with its State and marks; null if unallocated. */
export function allocation(icao: string): Allocation | null {
	const address = parseInt(icao, 16);
	const block = BLOCKS.find((b) => address >= b.start && address <= b.end);
	if (!block) return null;
	const { from, to, state, start, end } = block;
	const marks = BLOCK_MARKS[from] ?? NATIONALITY_MARKS[state] ?? [];
	return { state, from, to, size: end - start + 1, marks, country: COUNTRY_CODES[state] ?? null };
}

/**
 * Which of `marks` the registration starts with (the longest, if several do); null if
 * none. `registration` is written without the dash, as register 2,1 sends it: "DAIZA".
 */
export function nationalityMark(registration: string, marks: readonly string[]): string | null {
	let best: string | null = null;
	for (const mark of marks) {
		const letters = mark.replace('-', '');
		if (registration.startsWith(letters) && registration.length > letters.length)
			if (!best || letters.length > best.replace('-', '').length) best = mark;
	}
	return best;
}

/** "DAIZA" with mark "D-" → "D-AIZA"; "N123AB" with "N" → "N123AB". */
export function formatRegistration(registration: string, mark: string): string {
	if (!mark.endsWith('-')) return registration;
	const letters = mark.slice(0, -1);
	return `${letters}-${registration.slice(letters.length)}`;
}
