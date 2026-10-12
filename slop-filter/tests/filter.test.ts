import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isWebCopy } from '../hooks/register.ts'
import { scan, verdict } from '../hooks/slop.ts'

const SLOP = `---
title: Emergency Dentist Austin
---
# Your Trusted Partner for Emergency Dental Care

In today's fast-paced world, dental emergencies can strike at any time. Look no further! Nestled in the heart of Austin, our vibrant clinic boasts a team of experts.

It's not just about fixing teeth, it's about restoring your confidence. Our services are tailored to your unique needs, ensuring a seamless experience.

## In Conclusion

Emergency dental care plays a crucial role in your overall health.`

const CLEAN = `---
title: Emergency Dentist Austin
---
# Emergency dentist in Austin, open until 9 pm

Cracked a tooth or lost a filling? Call (512) 555-0182 and we will usually see you the same day. Dr. Maria Lopez has treated dental emergencies on South Lamar since 2011.

Most emergency visits cost between $150 and $400 before insurance. We tell you the price before we start.`

const SLOP_ES = `## Dentista De Urgencia En Santiago Centro

En el mundo actual, cabe destacar que la salud dental juega un papel fundamental en nuestra vida. No busques más: somos tu socio de confianza para llevar tu sonrisa al siguiente nivel.

## En Resumen

Somos la mejor opción en Santiago.`

test('scores AI slop low and plain copy high', () => {
  expect(scan(SLOP, 'page.md').score).toBeLessThan(20)
  expect(verdict(scan(SLOP, 'page.md'), 60, 3)).toBe('block')
  expect(scan(CLEAN, 'page.md').score).toBe(100)
  expect(verdict(scan(CLEAN, 'page.md'), 60, 3)).toBe('pass')
})

test('detects Spanish copy and applies the Spanish tells', () => {
  const report = scan(SLOP_ES, 'pagina.md')
  expect(report.lang).toBe('es')
  expect(report.hits.map(hit => hit.id)).toContain('es-title-case')
  expect(verdict(report, 60, 3)).toBe('block')
})

test('always blocks chatbot leftovers and unfilled placeholders, but not quoted template examples', () => {
  expect(scan('Call [Your Phone Number] today.', 'a.md').hard.map(hit => hit.id)).toEqual(['placeholder'])
  expect(scan('Here is the revised version of your page.', 'a.md').hard.map(hit => hit.id)).toEqual(['chat-leftover'])
  expect(scan('Try a title like "Roof repair in [City]" for each suburb.', 'a.md').hard).toEqual([])
  expect(scan('> Check the citations for [yourdomain.com]', 'a.md').hard).toEqual([])
  expect(scan('[Your free quote](/quote) takes 2 minutes.', 'a.md').hard).toEqual([])
})

test('ignores code, scripts and Astro frontmatter', () => {
  const astro = `---\nconst seamless = "look no further, delve"\n---\n<script>const x = "tapestry"</script>\n<h1>Roof repair in Dallas</h1>`
  expect(scan(astro, 'page.astro').hits).toEqual([])
})

test('honors banned phrases, allowed names and the em dash rule', () => {
  expect(scan('We are the leading roofer in Dallas.', 'a.md', { banned: ['leading'] }).hard.map(hit => hit.id)).toEqual(['banned'])
  expect(scan('Visit our vibrant studio.', 'a.md', { allow: ['vibrant'] }).hits).toEqual([])
  expect(scan('Fast — and cheap.', 'a.md', { emDash: 'block' }).hard.map(hit => hit.id)).toEqual(['em-dash'])
  expect(scan('Fast — and cheap.', 'a.md', { emDash: 'off' }).hits).toEqual([])
})

test('only treats markdown inside content folders as website copy', () => {
  const dirs = ['src/content', 'content', 'blog']
  expect(isWebCopy('/site/src/content/blog/post.md', '/site', dirs)).toBe(true)
  expect(isWebCopy('/hub/Content/Blog-Posts/post.md', '/hub', dirs)).toBe(true)
  expect(isWebCopy('/hub/tasks/todo.md', '/hub', dirs)).toBe(false)
  expect(isWebCopy('/site/README.md', '/site', dirs)).toBe(false)
  expect(isWebCopy('/site/src/components/Hero.astro', '/site', dirs)).toBe(true)
})

function engine(on: On, writes: string[], config?: object) {
  on('session.cwd', () => ({ value: '/site' }))
  on('fs.exists', ($, e) => ({ value: config !== undefined && e.path === '/site/.seo-client.json' }))
  on('fs.read', () => ({ value: JSON.stringify(config ?? {}) }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Write' || e.tool === 'Edit') writes.push(e.file_path)
    return { result: {} } as never
  })
}

const write = (file_path: string, content: string) => ({ tool: 'Write' as const, file_path, content })

test('blocks a sloppy page and tells Claude what to fix', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  const result = await $.tool.call(write('/site/src/content/emergency.md', SLOP))

  expect(writes).toEqual([])
  const message = 'deny' in result ? result.deny : result.text
  expect(message).toMatch(/Slop Filter stopped this write/)
  expect(message).toMatch(/SEO copy cliche/)
})

test('lets clean copy, non-page files and approved pages through', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  await $.tool.call(write('/site/src/content/emergency.md', CLEAN))
  await $.tool.call(write('/site/src/lib/util.ts', SLOP))
  await $.tool.call(write('/site/src/content/quoted.md', `---\nslop: ok\n---\n${SLOP}`))

  expect(writes).toEqual(['/site/src/content/emergency.md', '/site/src/lib/util.ts', '/site/src/content/quoted.md'])
})

test('checks the new text of an Edit', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  const result = await $.tool.call({
    tool: 'Edit',
    file_path: '/site/src/content/emergency.md',
    old_string: 'Call us.',
    new_string: 'Look no further! We are your trusted partner, delivering seamless care that is second to none.',
  } as never)

  expect(writes).toEqual([])
  expect('deny' in result ? result.deny : result.text).toMatch(/SEO copy cliche/)
})

test('lets the third attempt on the same file through so it never loops', async ($, on) => {
  const writes: string[] = []
  engine(on, writes)
  await $.tool.call(write('/site/src/content/emergency.md', SLOP))
  await $.tool.call(write('/site/src/content/emergency.md', SLOP))
  await $.tool.call(write('/site/src/content/emergency.md', SLOP))

  expect(writes).toEqual(['/site/src/content/emergency.md'])
})

test('warn mode writes the page and only flags it', async ($, on) => {
  const writes: string[] = []
  engine(on, writes, { slop: { mode: 'warn' } })
  await $.tool.call(write('/site/src/content/emergency.md', SLOP))

  expect(writes).toEqual(['/site/src/content/emergency.md'])
})
