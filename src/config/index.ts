import { type Config, type EnvSource, parseConfig } from './schema';

export { ConfigError } from './schema';
export type { Config } from './schema';

let cached: Config | undefined;

/**
 * Returns the validated configuration, parsing it on first use and reusing the
 * result afterwards.
 *
 * Throws a `ConfigError` naming every missing or invalid value. The app is meant
 * to call this once at startup, so an incomplete environment stops the server
 * rather than surfacing later as a write to the wrong place.
 */
export function loadConfig(source: EnvSource = process.env): Config {
  if (cached === undefined) {
    cached = parseConfig(source);
  }
  return cached;
}

/**
 * Clears the memoised config. A test seam: production code should never need to
 * re-read the environment.
 */
export function resetConfigCache(): void {
  cached = undefined;
}
