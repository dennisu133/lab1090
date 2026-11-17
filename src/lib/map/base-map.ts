/**
 * Is the base map reachable? The map's tiles, label fonts and terrain come from outside
 * (OpenFreeMap, AWS), fetched by the browser; lab1090's server needs no internet. So a
 * device without it gets live aircraft on an empty background, and should be told why.
 *
 * MapLibre reports every failed tile as an `error` event. Online, one now and then is
 * normal (a server hiccup) while the rest load, so a single error isn't enough: the map
 * counts as unreachable once an error is followed by GRACE_MS without any tile loading.
 * The first tile that loads clears it.
 *
 * MapLibre doesn't try again by itself: if the source's index (its TileJSON, which names
 * the current tile files) failed, the map stays empty for good. So while unreachable, the
 * source is reloaded every RETRY_MS, and at once when the browser says it's back online.
 */
import type { Map as MapLibreMap, MapSourceDataEvent, VectorTileSource } from 'maplibre-gl';

export const GRACE_MS = 3000;
export const RETRY_MS = 30_000;

/** The rule, without MapLibre or timers: fed with times, asked at a time. */
export class BaseMapHealth {
	#lastError = -Infinity;
	#lastLoad = -Infinity;

	error(t: number): void {
		this.#lastError = t;
	}

	loaded(t: number): void {
		this.#lastLoad = t;
	}

	/** An error, nothing loaded since, and long enough ago that something should have. */
	unreachable(t: number): boolean {
		return this.#lastError > this.#lastLoad && t - this.#lastError >= GRACE_MS;
	}
}

/**
 * Watch one vector source of a map (the base map: 'openmaptiles' in style.ts); `onChange`
 * gets true when it becomes unreachable, false when tiles load again. Returns a cleanup.
 */
export function watchBaseMap(
	map: MapLibreMap,
	onChange: (unreachable: boolean) => void,
	sourceId = 'openmaptiles'
): () => void {
	const health = new BaseMapHealth();
	let state = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let retries: ReturnType<typeof setInterval> | undefined;
	const retry = () => {
		const source = map.getSource<VectorTileSource>(sourceId);
		if (source?.url) source.setUrl(source.url);
	};
	const update = () => {
		const now = health.unreachable(performance.now());
		if (now === state) return;
		onChange((state = now));
		clearInterval(retries);
		if (state) retries = setInterval(retry, RETRY_MS);
	};
	const onOnline = () => {
		if (state) retry();
	};
	// Source errors carry the source's id (MapLibre's types don't say so).
	const onError = (e: object) => {
		if ((e as { sourceId?: string }).sourceId !== sourceId) return;
		health.error(performance.now());
		clearTimeout(timer);
		timer = setTimeout(update, GRACE_MS);
	};
	const onData = (e: MapSourceDataEvent) => {
		if (e.sourceId !== sourceId || !e.tile) return;
		health.loaded(performance.now());
		update();
	};
	map.on('error', onError);
	map.on('sourcedata', onData);
	window.addEventListener('online', onOnline);
	return () => {
		clearTimeout(timer);
		clearInterval(retries);
		window.removeEventListener('online', onOnline);
		map.off('error', onError);
		map.off('sourcedata', onData);
	};
}
