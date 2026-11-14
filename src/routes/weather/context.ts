import { createContext } from 'svelte';
import type { WeatherStream } from './weather-stream.svelte';

/**
 * The layout owns the one WeatherStream; the tabs read it from here. So switching tabs
 * keeps everything collected so far (the "Now" tab needs half an hour of it).
 */
export const [getWeatherStream, setWeatherStream] = createContext<WeatherStream>();
