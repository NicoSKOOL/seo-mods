import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { similarity, targetKeyword } from '../hooks/register.ts'

const ROOT = '/site'

const FILES: Record<string, string> = {
  '/site/.seo-client.json': JSON.stringify({ domain: 'acmedental.com' }),
  '/site/src/content/services/emergency-dentist.md': '---\ntitle: Emergency Dentist\nkeyword: emergency dentist austin\n---\nBody',
  '/site/src/content/services/implants.md': '---\ntitle: Implants\nkeyword: dental implants austin\n---\nBody',
}

const DIRS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  '/site/src/content': [{ name: 'services', kind: 'dir' }],
  '/site/src/content/services': [
    { name: 'emergency-dentist.md', kind: 'file' },
    { name: 'implants.md', kind: 'file' },
  ],
}

const QUERIES = [
  { query: 'teeth whitening austin', clicks: 12, impressions: 340, avg_position: 6.2, avg_ctr: 0.03 },
  { query: 'best teeth whitening in austin', clicks: 2, impressions: 80, avg_position: 9.1, avg_ctr: 0.02 },
]

const RANKED = [
  { keyword: 'teeth whitening austin tx', position: 5, search_volume: 590, url: 'https://acmedental.com/blog/whitening-guide/' },
]

function engine(on: On, writes: string[]) {
  const store = new Map<string, unknown>()
  on('session.cwd', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.exists', ($, e) => ({ value: e.path in FILES }))
  on('fs.read', ($, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', ($, e) => ({
    value: (DIRS[e.path] ?? []).map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('mcp.call', ($, e) => {
    const body =
      e.tool === 'datawise_ranked_keywords'
        ? { keywords: RANKED }
        : e.args.action === 'list_properties'
          ? { properties: [{ id: 'p1', site_url: 'sc-domain:acmedental.com', kind: 'gsc', is_enabled: 1 }] }
          : { queries: { rows: QUERIES } }
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } }
  })
  on('tool.call', { tool: 'Write' }, ($, e) => {
    writes.push(e.file_path)
    return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } } as never
  })
}

const write = (file_path: string, content: string) => ({ tool: 'Write' as const, file_path, content })

test('reads the target keyword from frontmatter, Astro code and HTML comments', () => {
  expect(targetKeyword('---\nkeyword: emergency dentist austin\n---')).toBe('emergency dentist austin')
  expect(targetKeyword('---\nconst targetKeyword = "roof repair dallas";\n---')).toBe('roof repair dallas')
  expect(targetKeyword('<!-- keyword: plumber denver -->\n<h1>Hi</h1>')).toBe('plumber denver')
  expect(targetKeyword('---\nkeywords: [a, b]\n---')).toBe(null)
})

test('treats near-identical keywords as the same and different cities as different', () => {
  expect(similarity('emergency dentist austin', 'emergency dentist in austin tx')).toBeGreaterThanOrEqual(0.6)
  expect(similarity('emergency dentist austin', 'emergency dentist dallas')).toBeLessThan(0.6)
  expect(similarity('dentista de urgencia santiago', 'dentista urgencia en santiago')).toBe(1)
})

test('blocks a new page whose keyword an existing local page targets', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  const result = await $.tool.call(write('/site/src/content/services/emergency-dental-care.md', '---\nkeyword: emergency dentist in austin\n---\nNew page'))

  expect(writes).toEqual([])
  expect('deny' in result ? result.deny : result.text).toMatch(/src\/content\/services\/emergency-dentist\.md/)
})

test('blocks a new page Google already ranks the site for, naming impressions and the ranking URL', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  const result = await $.tool.call(write('/site/src/content/blog/whitening.md', '---\nkeyword: teeth whitening austin\n---\nNew page'))
  const message = 'deny' in result ? result.deny : result.text

  expect(writes).toEqual([])
  expect(message).toMatch(/340 impressions/)
  expect(message).toMatch(/acmedental\.com\/blog\/whitening-guide/)
})

test('lets a page with a new keyword through', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  await $.tool.call(write('/site/src/content/services/veneers.md', '---\nkeyword: porcelain veneers austin\n---\nNew page'))

  expect(writes).toEqual(['/site/src/content/services/veneers.md'])
})

test('lets a page through when the user approved it with cannibalization: ok', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  await $.tool.call(write('/site/src/content/services/er-dentist.md', '---\nkeyword: emergency dentist austin\ncannibalization: ok\n---\nNew page'))

  expect(writes).toEqual(['/site/src/content/services/er-dentist.md'])
})
