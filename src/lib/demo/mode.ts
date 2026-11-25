/**
 * Built as the static demo (`bun run build:demo`, `bun run dev:demo`: Vite's `--mode demo`):
 * no server, a recording played in the page (player.ts), no /receiver and no /setup. A
 * constant at build time, so the other build leaves the demo's code out.
 */
export const DEMO = import.meta.env.MODE === 'demo';
