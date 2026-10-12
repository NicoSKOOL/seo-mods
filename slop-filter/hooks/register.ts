import type { EngineInterface, Register } from 'claude-code'

import { explain, scan, verdict } from './slop.ts'
import type { SlopOptions } from './slop.ts'

const CONFIG_FILE = '.seo-client.json'
const PAGE_FILE = /\.(md|mdx|astro|html|htm)$/i
const MARKUP_FILE = /\.(mdx|astro|html|htm)$/i
// Markdown is only website copy inside one of these folders (plans, notes and
// READMEs elsewhere are left alone). "contentDirs" in .seo-client.json replaces them.
const DEFAULT_CONTENT_DIRS = ['src/content', 'src/pages', 'content', 'pages', 'blog', 'posts']
// After this many blocks on one file in a session, the next write goes
// through with a warning, so a stubborn page never loops forever.
const MAX_BLOCKS_PER_FILE = 2

type Config = SlopOptions & { threshold: number; minTells: number; mode: 'block' | 'warn'; contentDirs: string[] }

async function loadConfig($: EngineInterface, root: string): Promise<Config> {
  const path = `${root}/${CONFIG_FILE}`
  const file = (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : {}
  const raw = file.slop ?? {}

  return {
    contentDirs: Array.isArray(file.contentDirs) ? file.contentDirs : DEFAULT_CONTENT_DIRS,
    threshold: raw.threshold ?? 60,
    minTells: raw.minTells ?? 3,
    mode: raw.mode === 'warn' ? 'warn' : 'block',
    banned: Array.isArray(raw.banned) ? raw.banned : [],
    allow: Array.isArray(raw.allow) ? raw.allow : [],
    emDash: raw.emDash === 'block' || raw.emDash === 'off' ? raw.emDash : 'count',
  }
}

export function isWebCopy(path: string, root: string, contentDirs: string[]): boolean {
  if (!PAGE_FILE.test(path)) return false
  if (MARKUP_FILE.test(path)) return true
  const relative = `/${(path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path).toLowerCase()}`

  return contentDirs.some(dir => relative.includes(`/${dir.toLowerCase().replace(/^\/|\/$/g, '')}/`))
}

const isOverridden = (content: string) => /\bslop\s*:\s*["']?ok\b/i.test(content.slice(0, 4000))

export const register: Register = on => {
  const blocks = new Map<string, number>()

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Write' && e.tool !== 'Edit') return next(e)
    const path = e.file_path
    const text = e.tool === 'Write' ? e.content : e.new_string
    if (!PAGE_FILE.test(path) || isOverridden(text)) return next(e)

    const root = await $.session.cwd()
    const config = await loadConfig($, root).catch(() => null)
    if (config === null || !isWebCopy(path, root, config.contentDirs)) return next(e)
    const report = scan(text, path, config)
    const name = path.split('/').slice(-2).join('/')

    if (verdict(report, config.threshold, config.minTells) === 'pass') {
      blocks.delete(path)
      $.ui.status(`Slop Filter: ${name} ${report.score}/100 clean`)
      return next(e)
    }

    const count = (blocks.get(path) ?? 0) + 1
    const message = explain(report, path)
    if (config.mode === 'warn' || count > MAX_BLOCKS_PER_FILE) {
      $.ui.status(`Slop Filter: ${name} ${report.score}/100 (written with a warning)`)
      const result = await next(e)
      if ('deny' in result && result.deny !== undefined) return result
      return { ...result, context: [...(result.context ?? []), message.replace('stopped this write to', 'flagged')] }
    }

    blocks.set(path, count)
    $.ui.status(`Slop Filter: ${name} ${report.score}/100 blocked`)
    $.ui.toast(`Slop Filter blocked ${name}: score ${report.score}/100, ${report.hits.length} tells. Claude is rewriting it.`)

    return { deny: message }
  })
}
