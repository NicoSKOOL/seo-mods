export type Pulse = {
  domain: string
  /** Last date Search Console data covers (YYYY-MM-DD). */
  syncedTo: string | null
  clicks7: number
  clicksDelta: number | null
  impressions7: number
  impressionsDelta: number | null
  avgPosition: number | null
  tracked: { ranking: number; total: number; up: number; down: number } | null
  aiCited: { cited: number; total: number } | null
  topOpportunity: { query: string; impressions: number; position: number } | null
  fetchedAt: number
}

export type PulseStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; domain: string }
  | { kind: 'ready'; pulse: Pulse }
  | { kind: 'error'; domain: string; message: string }

declare module 'claude-code' {
  interface PluginState {
    'client-pulse': { status: PulseStatus; isHidden: boolean }
  }
}
