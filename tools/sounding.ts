/**
 * Downloads a radiosonde ascent (weather balloon) from the University of Wyoming's
 * sounding archive and writes what the weather tests need as a small CSV, for
 * oracle/sounding/ (see oracle/README.md and src/lib/weather/sounding.test.ts).
 *
 *   bun tools/sounding.ts 10393 "2026-11-13 18:00" > oracle/sounding/10393-2026-11-13-18z.csv
 *
 * The first argument is the WMO station number (10393: Lindenberg, Germany), the second
 * the nominal time of the ascent in UTC (00, 06, 12 or 18 UTC). The balloon is launched
 * about 75 minutes before that, so it reaches the upper air around the nominal time.
 *
 * Wyoming serves the full-resolution ascent (one row per second, from the BUFR message the
 * weather service sends out). Kept here: one row per 25 m of height, up to 100 hPa (about
 * 16 km, well above where airliners fly), with time, position, pressure, geopotential
 * height, temperature, humidity (as mixing ratio: grams of water vapour per kg of dry air)
 * and wind.
 *
 * The archive often answers "server too busy": this tries again for a few minutes.
 */
const KEEP_EVERY_M = 25;
const TOP_HPA = 100;

const [station, when] = process.argv.slice(2);
if (!station || !when) throw new Error('usage: bun tools/sounding.ts 10393 "2026-11-13 18:00"');
const datetime = `${when}:00`;

const url = new URL('https://weather.uwyo.edu/wsgi/sounding');
url.search = new URLSearchParams({
	datetime,
	id: station,
	type: 'TEXT:CSV',
	src: 'BUFR'
}).toString();
// The archive answers 503 "The server is too busy, try again later." quite often.
let response = await fetch(url);
for (let attempt = 1; response.status === 503 && attempt < 6; attempt++) {
	console.error(`server busy, trying again in ${30 * attempt} s`);
	await Bun.sleep(30_000 * attempt);
	response = await fetch(url);
}
if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
const text = await response.text();

// time,longitude,latitude,pressure_hPa,geopotential height_m,temperature_C,dew point
// temperature_C,ice point temperature_C,relative humidity_%,humidity wrt ice_%,mixing
// ratio_g/kg,wind direction_degree,wind speed_m/s
const [header, ...lines] = text.trim().split('\n');
const columns = header.split(',');
const index = (name: string) => {
	const i = columns.indexOf(name);
	if (i < 0) throw new Error(`no column "${name}" in: ${header}`);
	return i;
};
const want = {
	time: index('time'),
	lat: index('latitude'),
	lon: index('longitude'),
	hPa: index('pressure_hPa'),
	m: index('geopotential height_m'),
	celsius: index('temperature_C'),
	mixing: index('mixing ratio_g/kg'),
	direction: index('wind direction_degree'),
	ms: index('wind speed_m/s')
};

const out: string[] = [];
let lastHeight = -Infinity;
for (const line of lines) {
	const f = line.split(',').map((s) => s.trim());
	const hPa = Number(f[want.hPa]);
	const m = Number(f[want.m]);
	if (hPa < TOP_HPA) break;
	if (m - lastHeight < KEEP_EVERY_M) continue;
	// Skip rows with a missing value rather than writing blanks.
	if (Object.values(want).some((i) => f[i] === '')) continue;
	lastHeight = m;
	out.push(
		[
			f[want.time].slice(11), // HH:MM:SS, the date is in the header
			f[want.lat],
			f[want.lon],
			f[want.hPa],
			f[want.m],
			f[want.celsius],
			f[want.mixing],
			f[want.direction],
			f[want.ms]
		].join(',')
	);
}
if (out.length === 0) throw new Error(`no data for station ${station} at ${datetime}`);

console.log(`# Radiosonde ascent, WMO station ${station}, nominal time ${datetime} UTC.
# Launched ${lines[0].split(',')[0].trim()} UTC. Data: Deutscher Wetterdienst (for German stations),
# via the University of Wyoming's sounding archive, ${url}
# One row per ${KEEP_EVERY_M} m up to ${TOP_HPA} hPa, written by tools/sounding.ts.
# Heights are geopotential metres above sea level; wind direction is where it blows from.
time_utc,lat,lon,pressure_hpa,height_m,temperature_c,mixing_ratio_g_kg,wind_from_deg,wind_ms
${out.join('\n')}`);
