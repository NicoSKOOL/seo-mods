import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pulse, PulseStatus } from '../types'

// The DataWise connector's name as /mcp lists it. A project can override it
// with "datawiseServer" in .seo-client.json.
const DEFAULT_SERVER = 'claude.ai DataWise SEO'
const CONFIG_FILE = '.seo-client.json'
const MAX_AGE_MS = 6 * 60 * 60 * 1000

const status = atom({ plugin: 'client-pulse', key: 'status' } as const, { kind: 'idle' } as PulseStatus)
const isHidden = atom({ plugin: 'client-pulse', key: 'isHidden' } as const, false)

type Config = { domain: string; server: string }
type Row = Record<string, any>

export function bareDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
}

export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
}

/** Last 7 days of the daily trend against the 7 before them. */
export function weekOverWeek(daily: { date: string; clicks: number; impressions: number }[]) {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted.slice(-7)
  const prev = sorted.slice(-14, -7)
  const sum = (rows: typeof sorted, field: 'clicks' | 'impressions') =>
    rows.reduce((total, row) => total + (row[field] ?? 0), 0)

  return {
    syncedTo: last.at(-1)?.date ?? null,
    clicks7: sum(last, 'clicks'),
    clicksDelta: prev.length === 7 ? percentChange(sum(last, 'clicks'), sum(prev, 'clicks')) : null,
    impressions7: sum(last, 'impressions'),
    impressionsDelta:
      prev.length === 7 ? percentChange(sum(last, 'impressions'), sum(prev, 'impressions')) : null,
  }
}

export function trackedMovement(keywords: Row[]) {
  const moved = (row: Row, isWorse: boolean) => {
    if (row.prev_position == null) return false
    if (row.position == null) return isWorse
    return isWorse ? row.position > row.prev_position : row.position < row.prev_position
  }

  return {
    ranking: keywords.filter(row => row.position != null).length,
    total: keywords.length,
    up: keywords.filter(row => moved(row, false)).length,
    down: keywords.filter(row => moved(row, true)).length,
  }
}

/** Citations across engines on the most recent check date. */
export function latestAiCitations(trend: Row[]) {
  const latest = trend.map(row => String(row.date)).sort().at(-1)
  if (latest === undefined) return null
  const rows = trend.filter(row => row.date === latest)

  return {
    cited: rows.reduce((total, row) => total + (row.cited ?? 0), 0),
    total: rows.reduce((total, row) => total + (row.total ?? 0), 0),
  }
}

async function datawise($: EngineInterface, server: string, tool: string, args: Row): Promise<Row> {
  const result = await $.mcp.call(server, tool, args)
  const text = result.content.find(block => block.type === 'text')?.text ?? ''
  if (result.isError) throw new Error(`${tool}: ${text.slice(0, 200)}`)

  return JSON.parse(text)
}

async function loadConfig($: EngineInterface): Promise<Config | null> {
  const path = `${await $.session.cwd()}/${CONFIG_FILE}`
  if (!(await $.fs.exists(path))) return null
  const raw = JSON.parse(await $.fs.read(path))
  if (typeof raw.domain !== 'string' || raw.domain === '') return null

  return { domain: bareDomain(raw.domain), server: raw.datawiseServer ?? DEFAULT_SERVER }
}

async function fetchPulse($: EngineInterface, config: Config): Promise<Pulse> {
  const { domain, server } = config
  const { properties = [] } = await datawise($, server, 'datawise_search_console', {
    action: 'list_properties',
  })
  const property = (properties as Row[])
    .filter(row => row.kind === 'gsc' && bareDomain(row.site_url) === domain)
    .sort((a, b) => Number(b.is_enabled) - Number(a.is_enabled) || String(b.last_synced_at ?? '').localeCompare(String(a.last_synced_at ?? '')))[0]
  if (property === undefined) throw new Error(`no Search Console property for ${domain} in DataWise`)

  const { overview } = await datawise($, server, 'datawise_search_console', {
    action: 'overview',
    property_id: property.id,
    range_days: 30,
    response_format: 'detailed',
  })
  const week = weekOverWeek(overview.daily_trend ?? [])
  const opportunity = (overview.opportunities ?? overview.range?.opportunities ?? [])[0]

  let tracked: Pulse['tracked'] = null
  let aiCited: Pulse['aiCited'] = null
  try {
    const { projects = [] } = await datawise($, server, 'datawise_rank_tracking', { action: 'list_projects' })
    const project = (projects as Row[])
      .filter(row => bareDomain(row.domain) === domain)
      .sort((a, b) => b.keyword_count - a.keyword_count)[0]
    if (project !== undefined) {
      const { keywords = [] } = await datawise($, server, 'datawise_rank_tracking', {
        action: 'project_keywords',
        project_id: project.id,
      })
      tracked = keywords.length > 0 ? trackedMovement(keywords) : null
      const { trend = [] } = await datawise($, server, 'datawise_ai_visibility', {
        project_id: project.id,
        period: 30,
      })
      aiCited = latestAiCitations(trend)
    }
  } catch {
    // Rank tracking and AI visibility are extras; the band still shows Search Console.
  }

  return {
    domain,
    ...week,
    avgPosition: overview.summary?.last_30_days?.avg_position ?? null,
    tracked,
    aiCited,
    topOpportunity: opportunity
      ? { query: opportunity.query, impressions: opportunity.impressions, position: opportunity.avg_position }
      : null,
    fetchedAt: await $.clock.now(),
  }
}

async function refresh($: EngineInterface, config: Config, isForced: boolean): Promise<PulseStatus> {
  const cacheKey = `pulse:${config.domain}`
  const cached = (await $.store.get(cacheKey)) as Pulse | undefined
  const isFresh = cached !== undefined && (await $.clock.now()) - cached.fetchedAt < MAX_AGE_MS

  if (cached !== undefined) await update($, status, (): PulseStatus => ({ kind: 'ready', pulse: cached }))
  if (isFresh && !isForced) return { kind: 'ready', pulse: cached }
  if (cached === undefined) await update($, status, (): PulseStatus => ({ kind: 'loading', domain: config.domain }))

  try {
    const pulse = await fetchPulse($, config)
    await $.store.set(cacheKey, pulse)
    const next: PulseStatus = { kind: 'ready', pulse }
    await update($, status, () => next)
    return next
  } catch (error) {
    const next: PulseStatus = { kind: 'error', domain: config.domain, message: String((error as Error).message ?? error) }
    if (cached === undefined) await update($, status, () => next)
    return next
  }
}

const signed = (n: number | null) => (n === null ? '' : ` (${n > 0 ? '+' : ''}${n}%)`)
const compact = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US'))

export function summarize(pulse: Pulse): string {
  const parts = [
    `${pulse.domain}`,
    `clicks 7d ${compact(pulse.clicks7)}${signed(pulse.clicksDelta)}`,
    `impressions 7d ${compact(pulse.impressions7)}${signed(pulse.impressionsDelta)}`,
  ]
  if (pulse.avgPosition !== null) parts.push(`avg position ${pulse.avgPosition}`)
  if (pulse.tracked) {
    parts.push(`tracked ${pulse.tracked.ranking}/${pulse.tracked.total} ranking (${pulse.tracked.up} up, ${pulse.tracked.down} down)`)
  }
  if (pulse.aiCited) parts.push(`AI citations ${pulse.aiCited.cited}/${pulse.aiCited.total}`)
  if (pulse.topOpportunity) {
    parts.push(`top opportunity "${pulse.topOpportunity.query}" (${pulse.topOpportunity.impressions} impressions, position ${pulse.topOpportunity.position})`)
  }
  if (pulse.syncedTo) parts.push(`data through ${pulse.syncedTo}`)

  return parts.join(' · ')
}

export const register: Register = on => {
  let config: Config | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pulse',
      description: 'Client Pulse: refresh the DataWise numbers, or switch client with /pulse example.com',
      argumentHint: '[domain]',
    })
    config = await loadConfig($).catch(() => null)
    const startConfig = config
    if (startConfig !== null) $.clock.after(1, () => void refresh($, startConfig, false))

    return next(e)
  })

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const domain = e.args.trim()
    if (domain !== '') {
      config = { domain: bareDomain(domain), server: config?.server ?? DEFAULT_SERVER }
    }
    if (config === null) {
      return { text: `Client Pulse: no client here. Add ${CONFIG_FILE} with {"domain": "example.com"} or run /pulse example.com` }
    }
    await update($, isHidden, () => false)
    const result = await refresh($, config, true)

    return result.kind === 'ready'
      ? { text: `Client Pulse: ${summarize(result.pulse)}` }
      : { text: `Client Pulse: could not load ${config.domain}: ${result.kind === 'error' ? result.message : 'still loading'}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, status)
    if (e.props.hasSurvey || current.kind === 'idle' || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const hide = <Button key="hide" plain label="×" onPress={() => update($, isHidden, () => true)} />

    if (current.kind === 'loading') {
      return (
        <Box>
          <Text dimColor>◆ {current.domain}: loading DataWise… </Text>
        </Box>
      )
    }
    if (current.kind === 'error') {
      return (
        <Box>
          <Text color="red">◆ {current.domain}: {current.message} </Text>
          {hide}
        </Box>
      )
    }

    const pulse = current.pulse
    const trend = (n: number | null) =>
      n === null ? null : (
        <Text color={n > 0 ? 'green' : n < 0 ? 'red' : undefined}>{signed(n)}</Text>
      )

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color="cyan">◆ {pulse.domain} </Text>
          <Text>  clicks 7d </Text>
          <Text bold>{compact(pulse.clicks7)}</Text>
          {trend(pulse.clicksDelta)}
          <Text>  impr </Text>
          <Text bold>{compact(pulse.impressions7)}</Text>
          {trend(pulse.impressionsDelta)}
          {pulse.avgPosition !== null && <Text>  avg pos {pulse.avgPosition}</Text>}
          <Text> </Text>
          {hide}
        </Box>
        <Box>
          {pulse.tracked && (
            <Text>
              <Text dimColor>  tracked </Text>
              {pulse.tracked.ranking}/{pulse.tracked.total}
              {pulse.tracked.up > 0 && <Text color="green"> ▲{pulse.tracked.up}</Text>}
              {pulse.tracked.down > 0 && <Text color="red"> ▼{pulse.tracked.down}</Text>}
            </Text>
          )}
          {pulse.aiCited && (
            <Text>
              <Text dimColor>  AI cited </Text>
              {pulse.aiCited.cited}/{pulse.aiCited.total}
            </Text>
          )}
          {pulse.topOpportunity && (
            <Text wrap="truncate-end">
              <Text dimColor>  opportunity </Text>"{pulse.topOpportunity.query}" #{Math.round(pulse.topOpportunity.position)}
            </Text>
          )}
          {pulse.syncedTo && <Text dimColor>  · data to {pulse.syncedTo}</Text>}
        </Box>
      </Box>
    )
  })
}
