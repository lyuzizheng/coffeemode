/**
 * Live-keys export fixture builder (BRAWUKA-757). The sweeper refuses any
 * non-empty LIVE_KEYS_FILE that is not a complete export artifact — strict
 * `original/<uuid>.webp` lines closed by the `# live-keys v1 total=<N>`
 * trailer — so fixtures must be written the way the exporter writes them.
 * The orphan-cleanup integration test that runs the real
 * `web/scripts/export-live-image-keys.mjs` covers the lockstep between this
 * builder and the producer.
 */
export function liveKeysExport(keys: string[]): string {
  return [...keys, `# live-keys v1 total=${keys.length}`].join("\n") + "\n";
}
