/**
 * The base map: is it reachable (watchBaseMap), and its credits (foldCredits, at the end).
 *
 * The map's tiles, label fonts and terrain come from outside (OpenFreeMap, AWS), fetched by
 * the browser; lab1090's server needs no internet. So a device without it gets live aircraft
 * on an empty background, and should be told why.
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
	// Source errors carry the source's id (MapLibre's types don't say so). The others are
	// logged: with a listener, MapLibre no longer does (a refused layer went unnoticed).
	const onError = (e: object) => {
		if ((e as { sourceId?: string }).sourceId !== sourceId) {
			console.error((e as { error?: unknown }).error ?? e);
			return;
		}
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

/** How long the credits stay open on a narrow map: OSMF's guidelines allow five seconds. */
export const CREDITS_MS = 5000;
/** Narrower than this, open credits cover the legend and the layer switches. */
const NARROW_PX = 800;

/**
 * The credits (MapLibre's compact attribution control) open expanded. On a narrow map they
 * cover the legend and the layers, so there they fold to the ⓘ on the first tap or zoom
 * (MapLibre itself only on a drag), or after CREDITS_MS. Never before they've been seen:
 * OSMF's attribution guidelines want them visible without a tap at first, and allow folding
 * them on map interaction or after five seconds. Opened again with the ⓘ, the next tap or
 * zoom folds them. Returns a cleanup.
 */
export function foldCredits(map: MapLibreMap, container: HTMLElement): () => void {
	if (container.clientWidth >= NARROW_PX) return () => {};
	const credits = container.querySelector('.maplibregl-ctrl-attrib');
	const fold = () => {
		credits?.classList.remove('maplibregl-compact-show');
		credits?.removeAttribute('open');
	};
	// Only the user's zooms (they carry the input event), not a fitBounds of our own.
	const onZoom = (e: { originalEvent?: unknown }) => {
		if (e.originalEvent) fold();
	};
	map.on('click', fold);
	map.on('zoomstart', onZoom);
	const timer = setTimeout(fold, CREDITS_MS);
	return () => {
		clearTimeout(timer);
		map.off('click', fold);
		map.off('zoomstart', onZoom);
	};
}
