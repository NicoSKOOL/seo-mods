import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bareDomain, latestAiCitations, pickProperty, trackedMovement, weekOverWeek } from '../hooks/register.tsx'

const days = (start: number, clicks: number[]) =>
  clicks.map((c, i) => ({ date: `2026-10-${String(start + i).padStart(2, '0')}`, clicks: c, impressions: c * 30 }))

const RESPONSES: Record<string, unknown> = {
  list_properties: {
    properties: [
      { id: 'old', site_url: 'https://www.acmedental.com/', kind: 'gsc', is_enabled: 0, last_synced_at: null },
      { id: 'p1', site_url: 'sc-domain:acmedental.com', kind: 'gsc', is_enabled: 1, last_synced_at: '2026-10-11' },
    ],
  },
  overview: {
    overview: {
      daily_trend: days(1, [10, 10, 10, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12, 12]),
      summary: { last_30_days: { avg_position: 7.1 } },
      opportunities: [{ query: 'uf to clp', impressions: 318, avg_position: 8.3 }],
    },
  },
  list_projects: { projects: [{ id: 'r1', domain: 'acmedental.com', keyword_count: 3 }] },
  project_keywords: {
    keywords: [
      { keyword: 'a', position: 3, prev_position: 5 },
      { keyword: 'b', position: null, prev_position: 2 },
      { keyword: 'c', position: 4, prev_position: 4 },
    ],
  },
  datawise_ai_visibility: {
    trend: [
      { date: '2026-10-07', engine: 'chatgpt', total: 7, cited: 1 },
      { date: '2026-10-07', engine: 'perplexity', total: 7, cited: 3 },
      { date: '2026-09-17', engine: 'perplexity', total: 5, cited: 5 },
    ],
  },
}

function engine(on: On) {
  const store = new Map<string, unknown>()
  on('session.cwd', () => ({ value: '/elsewhere' }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('mcp.call', ($, e) => {
    const body = RESPONSES[String(e.args.action ?? e.tool)]
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
}

test('compares the last 7 days with the 7 before', () => {
  const week = weekOverWeek(days(1, [10, 10, 10, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12, 12]))
  expect(week.clicks7).toBe(84)
  expect(week.clicksDelta).toBe(20)
  expect(week.syncedTo).toBe('2026-10-14')
  expect(weekOverWeek(days(1, [5, 5])).clicksDelta).toBe(null)
})

test('counts tracked keywords that moved, a lost ranking as a drop', () => {
  expect(trackedMovement(RESPONSES.project_keywords && (RESPONSES.project_keywords as any).keywords)).toEqual({
    ranking: 2,
    total: 3,
    up: 1,
    down: 1,
  })
})

test('reads AI citations from the latest check only', () => {
  expect(latestAiCitations((RESPONSES.datawise_ai_visibility as any).trend)).toEqual({ cited: 4, total: 14 })
})

test('normalizes Search Console property names to a bare domain', () => {
  expect(bareDomain('sc-domain:AcmeDental.com')).toBe('acmedental.com')
  expect(bareDomain('https://www.acmedental.com/blog/')).toBe('acmedental.com')
})

test('prefers the domain property over a more recently synced URL-prefix property', () => {
  const properties = [
    { id: 'domain', site_url: 'sc-domain:airankingskool.com', kind: 'gsc', is_enabled: 1, last_synced_at: '2026-10-10 21:30:40' },
    { id: 'www', site_url: 'https://www.airankingskool.com/', kind: 'gsc', is_enabled: 1, last_synced_at: '2026-10-12 01:55:42' },
    { id: 'other', site_url: 'sc-domain:example.com', kind: 'gsc', is_enabled: 1, last_synced_at: '2026-10-12 09:00:00' },
  ]
  expect(pickProperty(properties, 'airankingskool.com')?.id).toBe('domain')
  expect(pickProperty(properties.slice(1), 'airankingskool.com')?.id).toBe('www')
})

test('/pulse loads a client and the band shows its numbers on every surface', async ($, on) => {
  engine(on)
  on('command.register', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  await $.session.start({ source: 'startup', cwd: '/elsewhere' } as never)
  const answer = await $.command.run({ command: 'pulse', args: 'acmedental.com' } as never)

  expect((answer as { text?: string }).text).toMatch(/clicks 7d 84 \(\+20%\)/)
  expect((answer as { text?: string }).text).toMatch(/tracked 2\/3 ranking \(1 up, 1 down\)/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'client-pulse',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 },
    } as never)
    expect(await ui.find({ type: 'Text', text: /acmedental\.com/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+20%/ })).toBeDefined()
    await ui.unmount()
  }
})
