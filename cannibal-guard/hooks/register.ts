import type { EngineInterface, Register } from 'claude-code'

// The DataWise connector's name as /mcp lists it. A project can override it
// with "datawiseServer" in .seo-client.json.
const DEFAULT_SERVER = 'claude.ai DataWise SEO'
const CONFIG_FILE = '.seo-client.json'
const DEFAULT_CONTENT_DIRS = ['src/content', 'src/pages', 'content', 'pages']
const PAGE_FILE = /\.(md|mdx|astro|html)$/i
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.astro', '.next', '.wrangler'])
const MAX_FILES = 2000
const DAY_MS = 24 * 60 * 60 * 1000
const SIMILARITY = 0.6

type Row = Record<string, any>
type Config = {
  domain: string | null
  server: string
  contentDirs: string[]
  minImpressions: number
  useRankedKeywords: boolean
  locationCode?: number
  languageCode?: string
}
type LocalPage = { path: string; keyword: string }
type Clash =
  | { source: 'local'; path: string; keyword: string }
  | { source: 'search-console'; query: string; impressions: number; clicks: number; position: number }
  | { source: 'ranked'; keyword: string; url: string; position: number; volume: number }

const STOPWORDS = new Set(
  'a an the in on at for of to and or near me best top my your with by from de la el los las en y o para del al con por cerca mejor'.split(' '),
)

export function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 0 && !STOPWORDS.has(word))

  return new Set(words)
}

/** Share of words two keywords have in common (Jaccard over their meaningful words). */
export function similarity(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return 0
  const shared = [...left].filter(word => right.has(word)).length

  return shared / (left.size + right.size - shared)
}

/** The target keyword a page declares: frontmatter, an Astro const, or an HTML comment. */
export function targetKeyword(content: string): string | null {
  const head = content.slice(0, 4000)
  const match = head.match(
    /\b(?:target_?keyword|targetKeyword|primary_?keyword|primaryKeyword|focus_?keyword|focusKeyword|keyword)\b\s*[:=]\s*["'`]?([^"'`\n]+?)["'`]?\s*(?:;|,|-->|$)/im,
  )
  const keyword = match?.[1]?.trim()

  return keyword ? keyword : null
}

export const isOverridden = (content: string) => /\bcannibali[sz]ation\s*:\s*["']?ok\b/i.test(content.slice(0, 4000))

const bareDomain = (url: string) =>
  url.toLowerCase().replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')

async function datawise($: EngineInterface, server: string, tool: string, args: Row): Promise<Row> {
  const result = await $.mcp.call(server, tool, args)
  const text = result.content.find(block => block.type === 'text')?.text ?? ''
  if (result.isError) throw new Error(`${tool}: ${text.slice(0, 200)}`)

  return JSON.parse(text)
}

async function loadConfig($: EngineInterface, root: string): Promise<Config> {
  const path = `${root}/${CONFIG_FILE}`
  const raw: Row = (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {}

  return {
    domain: typeof raw.domain === 'string' && raw.domain !== '' ? bareDomain(raw.domain) : null,
    server: raw.datawiseServer ?? DEFAULT_SERVER,
    contentDirs: Array.isArray(raw.contentDirs) ? raw.contentDirs : DEFAULT_CONTENT_DIRS,
    minImpressions: raw.cannibalization?.minImpressions ?? 20,
    useRankedKeywords: raw.cannibalization?.rankedKeywords ?? true,
    locationCode: raw.locationCode,
    languageCode: raw.languageCode,
  }
}

async function walk($: EngineInterface, dir: string, found: string[], depth = 0): Promise<void> {
  if (depth > 8 || found.length >= MAX_FILES) return
  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    if (found.length >= MAX_FILES) return
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir' && !SKIP_DIRS.has(entry.name)) await walk($, path, found, depth + 1)
    else if (entry.kind === 'file' && PAGE_FILE.test(entry.name)) found.push(path)
  }
}

async function indexLocalPages($: EngineInterface, root: string, dirs: string[]): Promise<LocalPage[]> {
  const files: string[] = []
  for (const dir of dirs) await walk($, `${root}/${dir}`, files)
  const pages: LocalPage[] = []
  for (const path of files) {
    const keyword = targetKeyword(await $.fs.read(path).catch(() => ''))
    if (keyword !== null) pages.push({ path, keyword })
  }

  return pages
}

/** Search Console queries and DataForSEO ranked keywords, cached once a day per domain. */
async function searchData($: EngineInterface, config: Config): Promise<{ queries: Row[]; ranked: Row[] }> {
  const domain = config.domain
  if (domain === null) return { queries: [], ranked: [] }
  const cacheKey = `search:v2:${domain}`
  const cached = (await $.store.get(cacheKey)) as { at: number; queries: Row[]; ranked: Row[] } | undefined
  if (cached !== undefined && (await $.clock.now()) - cached.at < DAY_MS) return cached

  let queries: Row[] = []
  try {
    const { properties = [] } = await datawise($, config.server, 'datawise_search_console', { action: 'list_properties' })
    // A domain property (sc-domain:) covers every version of the site, so it wins.
    const property = (properties as Row[])
      .filter(row => row.kind === 'gsc' && row.is_enabled && bareDomain(row.site_url) === domain)
      .sort((a, b) => Number(String(b.site_url).startsWith('sc-domain:')) - Number(String(a.site_url).startsWith('sc-domain:')))[0]
    if (property !== undefined) {
      const result = await datawise($, config.server, 'datawise_search_console', {
        action: 'queries',
        property_id: property.id,
        sort: 'impressions',
        limit: 200,
      })
      queries = result.queries?.rows ?? []
    }
  } catch {
    // No Search Console data: the local check and ranked keywords still run.
  }

  let ranked: Row[] = []
  if (config.useRankedKeywords) {
    try {
      const result = await datawise($, config.server, 'datawise_ranked_keywords', {
        domain,
        limit: 100,
        ...(config.locationCode ? { location_code: config.locationCode } : {}),
        ...(config.languageCode ? { language_code: config.languageCode } : {}),
      })
      ranked = result.keywords ?? []
    } catch {
      // DataForSEO lookup is optional.
    }
  }

  const fresh = { at: await $.clock.now(), queries, ranked }
  await $.store.set(cacheKey, fresh)

  return fresh
}

export function findClashes(
  keyword: string,
  newPath: string,
  pages: LocalPage[],
  queries: Row[],
  ranked: Row[],
  minImpressions: number,
): Clash[] {
  const local: Clash[] = pages
    .filter(page => page.path !== newPath && similarity(keyword, page.keyword) >= SIMILARITY)
    .map(page => ({ source: 'local', path: page.path, keyword: page.keyword }))

  const matchedQueries = queries.filter(row => similarity(keyword, row.query) >= SIMILARITY)
  const totalImpressions = matchedQueries.reduce((total, row) => total + (row.impressions ?? 0), 0)
  const console: Clash[] =
    totalImpressions >= minImpressions
      ? matchedQueries
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 3)
          .map(row => ({
            source: 'search-console',
            query: row.query,
            impressions: row.impressions,
            clicks: row.clicks,
            position: row.avg_position,
          }))
      : []

  const rankedClashes: Clash[] = ranked
    .filter(row => row.url && similarity(keyword, row.keyword) >= SIMILARITY)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3)
    .map(row => ({ source: 'ranked', keyword: row.keyword, url: row.url, position: row.position, volume: row.search_volume }))

  return [...local, ...console, ...rankedClashes]
}

export function explain(keyword: string, newPath: string, clashes: Clash[], root: string): string {
  const relative = (path: string) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path)
  const lines = clashes.map(clash => {
    if (clash.source === 'local') return `- Existing page ${relative(clash.path)} already targets "${clash.keyword}".`
    if (clash.source === 'search-console') {
      return `- Google already shows this site for "${clash.query}": ${clash.impressions} impressions, ${clash.clicks} clicks, average position ${clash.position} (Search Console via DataWise).`
    }
    return `- ${clash.url} already ranks #${clash.position} for "${clash.keyword}" (${clash.volume}/mo).`
  })

  return [
    `Cannibalization Guard stopped this new page: ${relative(newPath)} targets "${keyword}", which the site already covers.`,
    ...lines,
    'Two pages on one keyword split rankings. Improve the existing page instead (add the new content there, or make the new page target a different keyword).',
    'Tell the user what was found. Only if the user confirms a separate page is intended, add `cannibalization: ok` to its frontmatter and write it again.',
  ].join('\n')
}

export const register: Register = on => {
  let localIndex: { root: string; pages: LocalPage[] } | null = null

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const path = e.file_path
    if (!PAGE_FILE.test(path) || isOverridden(e.content)) return next(e)
    const keyword = targetKeyword(e.content)
    if (keyword === null || (await $.fs.exists(path))) return next(e)

    const root = await $.session.cwd()
    const config = await loadConfig($, root)
    if (localIndex === null || localIndex.root !== root) {
      localIndex = { root, pages: await indexLocalPages($, root, config.contentDirs) }
    }
    $.ui.status(`Cannibalization Guard: checking "${keyword}"`)
    const { queries, ranked } = await searchData($, config)
    $.ui.status(undefined)

    const clashes = findClashes(keyword, path, localIndex.pages, queries, ranked, config.minImpressions)
    if (clashes.length > 0) {
      $.ui.toast(`Cannibalization Guard: "${keyword}" is already covered. Claude was told to improve the existing page.`)
      return { deny: explain(keyword, path, clashes, root) }
    }

    const result = await next(e)
    if (!('deny' in result && result.deny !== undefined)) localIndex.pages.push({ path, keyword })

    return result
  })
}
