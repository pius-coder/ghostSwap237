// Engine selection for live sessions.
//   "fast" — Reactor X2 (prioritized, default)
//   "pro"  — Morphly Lucy 2.5 (deprecated, kept working)
export type LiveProvider = 'fast' | 'pro';

// v2 deliberately ignores the old preference: strict Pro deprecation must not
// silently boot returning users into Morphly. Explicit v2 choices still persist.
const KEY = 'henshin.liveProvider.v2';

export const LIVE_PROVIDER_OPTIONS: { value: LiveProvider; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: 'Reactor X2' },
  { value: 'pro', label: 'Pro', hint: 'Morphly · deprecated' },
];

export const DEFAULT_LIVE_PROVIDER: LiveProvider = 'fast';

export function isLiveProvider(value: unknown): value is LiveProvider {
  return value === 'fast' || value === 'pro';
}

export function loadLiveProvider(): LiveProvider {
  if (typeof window === 'undefined') return DEFAULT_LIVE_PROVIDER;
  try {
    const raw = localStorage.getItem(KEY);
    return isLiveProvider(raw) ? raw : DEFAULT_LIVE_PROVIDER;
  } catch {
    return DEFAULT_LIVE_PROVIDER;
  }
}

export function saveLiveProvider(provider: LiveProvider): void {
  try {
    localStorage.setItem(KEY, provider);
  } catch {
    /* best effort */
  }
}
