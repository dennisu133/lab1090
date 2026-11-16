import { Coverage, type CoveragePoint, type Sector } from '#lib/coverage/coverage.ts';
import { CoverageFeed } from '#lib/coverage/feed.ts';
import { loadTerrain, type Terrain } from '#lib/coverage/terrain.ts';
import { LiveFeed } from '#lib/live-feed.svelte.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import type { TrackerStream } from '../../tracker-stream.svelte';

/** The sectors are published at most this often, ms; the plot's points less often. */
const SECTORS_MS = 1000;
const POINTS_MS = 5000;

/**
 * The coverage experiment's view of the live stream (/experimental/coverage): every
 * confirmed airborne position the tracker keeps, into a Coverage (lib/coverage).
 *
 * A stream listener after the tracker (streams.ts), like the radars, but it collects from
 * the start, on every page: a few sums per position, nothing to notice. It reads the
 * trails (lib/coverage/feed.ts), so it starts with the server's last 10 minutes.
 *
 * The terrain skyline (lib/coverage/terrain.ts) loads when the page is first opened: ~30
 * elevation tiles from AWS.
 */
export class CoverageStream extends LiveFeed<never> {
	sectors = $state.raw<Sector[]>([]);
	/** Thinned positions for the sky plot, oldest first. */
	points = $state.raw<CoveragePoint[]>([]);
	/** Positions counted, and the time span they cover (server clock); null: none yet. */
	positions = $state(0);
	first = $state<number | null>(null);
	last = $state<number | null>(null);
	terrain = $state.raw<Terrain | null>(null);
	terrainState = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');

	#tracker: TrackerStream;
	#receiver: () => LatLon | null;
	#coverage: Coverage | null = null;
	#feed = new CoverageFeed();
	#sectorsAt = -Infinity;
	#pointsAt = -Infinity;
	/** An extreme changed since the sectors were last published. */
	#dirty = false;

	constructor(tracker: TrackerStream, receiver: () => LatLon | null) {
		super(0);
		this.#tracker = tracker;
		this.#receiver = receiver;
	}

	/** The page calls it: load the terrain (once). */
	start(): void {
		const receiver = this.#receiver();
		if (!receiver || this.terrainState === 'loading' || this.terrainState === 'ready') return;
		this.terrainState = 'loading';
		loadTerrain(receiver).then(
			(terrain) => {
				this.terrain = terrain;
				this.terrainState = 'ready';
				this.#coverage?.setAntenna(terrain.antennaKm);
				this.#publish(0, true);
			},
			() => (this.terrainState = 'failed')
		);
	}

	protected reset(): void {
		this.#coverage = null;
		this.#feed = new CoverageFeed();
		this.sectors = [];
		this.points = [];
		this.positions = 0;
		this.first = null;
		this.last = null;
	}

	protected process(frames: WireFrame[]): never[] {
		if (frames.length === 0) return [];
		const receiver = this.#receiver();
		if (!receiver) return [];
		this.#coverage ??= new Coverage(receiver, this.terrain?.antennaKm ?? 0);
		if (this.#feed.add(this.#coverage, this.#tracker.aircraft)) this.#dirty = true;
		this.#publish(frames.at(-1)!.rx);
		return [];
	}

	/**
	 * Hand the snapshot to the page: the sectors at most every SECTORS_MS once an extreme
	 * changed, the plot's points every POINTS_MS. `force`: both now (the antenna height moved
	 * every angle).
	 */
	#publish(now: number, force = false): void {
		const c = this.#coverage;
		if (!c) return;
		if (force || (this.#dirty && now - this.#sectorsAt >= SECTORS_MS)) {
			if (!force) this.#sectorsAt = now;
			this.#dirty = false;
			this.sectors = c.sectors();
		}
		this.positions = c.positions;
		this.first = c.first;
		this.last = c.last;
		if (force || now - this.#pointsAt >= POINTS_MS) {
			if (!force) this.#pointsAt = now;
			this.points = c.points();
		}
	}
}
