// The Slop Filter's scorer: plain functions with no engine calls, so it can be
// tested and calibrated on its own.
//
// Pattern sources: Wikipedia "Signs of AI writing" (WikiProject AI Cleanup),
// sam-paech/slop-score and eric-tramel/slop-guard (MIT), plus SEO service-page
// cliches and Spanish tells collected for this mod.

export type Tier = 'hard' | 'high' | 'low'

export type Pattern = {
  id: string
  label: string
  tier: Tier
  regex: RegExp
  /** Points per hit (hard-tier patterns block on their own and score nothing). */
  weight: number
  /** Hits counted at most this many times. */
  cap?: number
  /** Only applied to text in this language. */
  lang?: 'en' | 'es'
  /** Matched only outside quotes and blockquotes (where a page quotes a template or prompt). */
  isProseOnly?: boolean
}

export type Hit = { id: string; label: string; tier: Tier; count: number; example: string; points: number; phrases: string[] }

export type Report = {
  words: number
  lang: 'en' | 'es'
  points: number
  score: number
  hits: Hit[]
  hard: Hit[]
  /** Distinct phrases among the high and low tells found. */
  distinct: number
}

export type SlopOptions = {
  /** Extra phrases that always block (case-insensitive, matched as words). */
  banned?: string[]
  /** Pattern ids or phrases to ignore (a business or place name, say). */
  allow?: string[]
  /** 'block' makes any em dash a hard stop, 'count' scores them, 'off' ignores them. */
  emDash?: 'block' | 'count' | 'off'
}

const words = (list: string) => list.split('|').join('|')

const PATTERNS: Pattern[] = [
  // Hard: text a person never publishes on a web page.
  { id: 'chatbot-citation', label: 'chatbot citation artifact', tier: 'hard', weight: 0, regex: /\b(?:oaicite|contentReference|turn\d+search\d+)\b|\[cite:\s*\d+\]|utm_source=chatgpt\.com/gi },
  { id: 'chat-leftover', label: 'leftover chat reply', tier: 'hard', weight: 0, regex: /\bas an ai (?:language model|assistant|model)\b|\blet me know if you(?:'d| would) like (?:me to|any)\b|\bhere(?:'s| is) (?:a|the) (?:revised|rewritten|updated|polished) version\b|^\s*(?:certainly|absolutely)! (?:here|below)\b/gim },
  { id: 'cutoff', label: 'knowledge cutoff disclaimer', tier: 'hard', weight: 0, regex: /\bas of my (?:last|latest) (?:update|knowledge|training)\b|\bknowledge cutoff\b/gi },
  { id: 'placeholder', label: 'unfilled placeholder', tier: 'hard', weight: 0, isProseOnly: true, regex: /\[(?:your|insert|city|company|business name|phone|address|tu |nombre|ciudad)[^\]\n]{0,30}\](?!\()|\blorem ipsum\b/gi },

  // High: words and phrases far more common in AI text than human text.
  { id: 'ai-vocabulary', label: 'AI vocabulary', tier: 'high', weight: 3, cap: 6, regex: new RegExp(`\\b(?:${words('delve[sd]?|delving|tapestry|testament to|intricate|multifaceted|realm|pivotal|underscores?|underscored|showcasing|garner(?:s|ed)?|bustling|vibrant|boasts|nestled|indelible|ever-evolving|evolving landscape|embark(?:s|ing)? on|beacon of|meticulous(?:ly)?|a myriad of|plethora of|navigate the complexities|in the heart of')})\\b`, 'gi') },
  { id: 'stock-opener', label: 'stock opener', tier: 'high', weight: 4, regex: /\bin today'?s (?:fast-paced|digital|modern|ever-changing|competitive|dynamic)? ?(?:world|landscape|age|era|market|environment)\b|\bin the (?:ever-evolving|dynamic|fast-paced|ever-changing) (?:world|realm|landscape) of\b/gi },
  { id: 'stock-closer', label: 'stock filler phrase', tier: 'high', weight: 3, regex: /\bcannot be overstated\b|\bit(?:'s| is) (?:worth noting|important to note)\b|\bplays? an? (?:crucial|pivotal|vital|key) role\b|\bwhether you(?:'re| are) an? [^.,;\n]{2,40} or an? \b/gi },
  { id: 'seo-cliche', label: 'SEO copy cliche', tier: 'high', weight: 3, regex: /\blook no further\b|\bunlock(?:ing)? the (?:power|potential|secrets?)\b|\byour trusted partner\b|\belevate your\b|\btake your [^.,;\n]{1,30} to the next level\b|\bseamless(?:ly)?\b|\bgame[- ]changer\b|\bone-stop shop\b|\bwe pride ourselves\b|\bsecond to none\b|\btailored to (?:meet )?your (?:unique |specific )?needs\b/gi },
  { id: 'negative-parallelism', label: '"it\'s not just X, it\'s Y"', tier: 'high', weight: 3, regex: /\b(?:it'?s|this is|that'?s|it is)\s+not\s+(?:just|only|merely|simply|about)\b[^.!?\n]{1,80}?[,;:—–-]\s*(?:it'?s|it is|but|this is)\b/gi },
  { id: 'not-only', label: '"not only... but also"', tier: 'high', weight: 2, regex: /\bnot only\b[^.!?\n]{1,80}\bbut also\b/gi },
  { id: 'copula-avoidance', label: '"serves as / stands as"', tier: 'high', weight: 2, regex: /\b(?:serves|stands|functions) as (?:a|an|the)\b/gi },
  { id: 'significance-clause', label: 'trailing "-ing" significance clause', tier: 'high', weight: 2, regex: /,\s(?:highlighting|underscoring|showcasing|reflecting|ensuring|fostering|emphasizing|solidifying|cementing)\s(?:the|its|their|our|your|a|an)\b/gi },
  { id: 'chat-signoff', label: 'chatbot sign-off', tier: 'high', weight: 2, cap: 1, regex: /\bi hope this (?:helps|was helpful)\b|\bgreat question\b/gi },
  { id: 'hype-hook', label: 'hype hook ("Here\'s the thing")', tier: 'high', weight: 3, regex: /\bhere'?s the (?:thing|kicker|catch)\b|\blet'?s dive in\b|\bthe best part\?|\bbut here'?s the\b/gi },
  { id: 'conclusion', label: '"In conclusion / In summary"', tier: 'high', weight: 2, regex: /^#{0,6}\s*\**(?:in conclusion|in summary|to sum up|final thoughts)\b/gim },

  // Spanish high tier.
  { id: 'es-connector', label: 'conector de IA', tier: 'high', weight: 3, lang: 'es', regex: /\bcabe (?:destacar|mencionar|señalar|resaltar)\b|\bes importante (?:destacar|mencionar|señalar|recordar|tener en cuenta)\b|\ben el mundo actual\b|\ben la era digital\b|\ben el (?:dinámico|cambiante|competitivo) mundo de\b/gi },
  { id: 'es-vocabulary', label: 'vocabulario de IA', tier: 'high', weight: 3, lang: 'es', regex: /\bun tapiz de\b|\btestamento de\b|\bjuega(?:n)? un papel (?:crucial|clave|fundamental|vital)\b|\bsumérgete\b|\bprofundizar en\b|\bno busques más\b|\btu socio de confianza\b|\bal siguiente nivel\b|\bdesbloquea(?:r)? (?:el|todo (?:el|su|tu)) (?:poder|potencial)\b|\bsin lugar a dudas\b/gi },
  { id: 'es-conclusion', label: '"En conclusión / En resumen"', tier: 'high', weight: 2, lang: 'es', regex: /^#{0,6}\s*\**(?:en conclusión|en resumen|para concluir)\b/gim },
  { id: 'es-title-case', label: 'título con Mayúsculas en Cada Palabra', tier: 'high', weight: 2, lang: 'es', regex: /^#{1,6}\s+(?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+\s+(?:(?:de|la|el|en|y|para|los|las|del|con|por|a)\s+)?){2,}[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+\s*$/gm },

  // Low: common in human writing too, so they only count toward density.
  { id: 'filler-words', label: 'filler transition words', tier: 'low', weight: 1, cap: 5, regex: /\b(?:additionally|moreover|furthermore|crucial|comprehensive|robust|leverag(?:e|es|ing)|streamline[sd]?|empower(?:s|ing)?|enhance[sd]?|ensuring)\b/gi },
  { id: 'es-filler', label: 'muletillas', tier: 'low', weight: 1, cap: 5, lang: 'es', regex: /\b(?:fundamental|esencial|además|por ende|en este sentido|destacar|resaltar|subrayar|potenciar|optimizar)\b/gi },
  { id: 'soft-cta', label: 'stock CTA', tier: 'low', weight: 1, cap: 2, regex: /\bpeace of mind\b|\ba wide range of\b|\bdon'?t wait\b|\bcontact us today to\b/gi },
  { id: 'vague-attribution', label: 'unsourced "studies show"', tier: 'low', weight: 2, cap: 3, regex: /\b(?:studies|research) (?:show|shows|suggest|suggests|has shown)\b|\bexperts (?:agree|say|believe)\b/gi },
  { id: 'bold-label-bullets', label: 'bullets with bold inline labels', tier: 'low', weight: 1, cap: 4, regex: /^\s*[-*]\s+\*\*[^*\n]{1,40}\*\*\s*:/gm },
  { id: 'emoji-bullets', label: 'emoji bullets or headings', tier: 'low', weight: 1, cap: 4, regex: /^\s*(?:[-*]\s*|#{1,6}\s*)?\p{Extended_Pictographic}/gmu },
]

const EM_DASH = /—/g

const SPANISH_MARKERS = /\b(?:de|la|que|el|en|los|las|del|para|con|una|por|es|su|se)\b/gi
const ENGLISH_MARKERS = /\b(?:the|and|of|to|is|for|with|you|your|that|are|on|this)\b/gi

export function detectLanguage(text: string): 'en' | 'es' {
  const es = text.match(SPANISH_MARKERS)?.length ?? 0
  const en = text.match(ENGLISH_MARKERS)?.length ?? 0

  return es > en ? 'es' : 'en'
}

/** The words a reader sees: no code, scripts, styles, JSON-LD, tag markup or Astro frontmatter. */
export function readableText(source: string, path = ''): string {
  let text = source
  if (/\.astro$/i.test(path)) text = text.replace(/^---[\s\S]*?\n---/, '')
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{[^{}\n]*\}/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/^\s*(?:import|export) .*$/gm, ' ')
}

const escape = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

export function scan(source: string, path = '', options: SlopOptions = {}): Report {
  const text = readableText(source, path)
  const lang = detectLanguage(text)
  const wordCount = text.split(/\s+/).filter(word => /\p{L}/u.test(word)).length
  const allow = (options.allow ?? []).map(entry => entry.toLowerCase())
  const isAllowed = (pattern: Pattern, match: string) =>
    allow.includes(pattern.id) || allow.some(entry => match.toLowerCase().includes(entry))

  const patterns: Pattern[] = [...PATTERNS]
  if (options.banned?.length) {
    patterns.push({
      id: 'banned',
      label: 'banned by your rules',
      tier: 'hard',
      weight: 0,
      regex: new RegExp(`(?<![\\p{L}])(?:${options.banned.map(escape).join('|')})(?![\\p{L}])`, 'giu'),
    })
  }
  const emDash = options.emDash ?? 'count'
  if (emDash !== 'off') {
    patterns.push(
      emDash === 'block'
        ? { id: 'em-dash', label: 'em dash (banned by your rules)', tier: 'hard', weight: 0, regex: EM_DASH }
        : { id: 'em-dash', label: 'em dashes', tier: 'low', weight: 0.5, cap: 10, regex: EM_DASH },
    )
  }

  const prose = text.replace(/^\s*>.*$/gm, ' ').replace(/"[^"\n]{0,300}"|“[^”\n]{0,300}”/g, ' ')
  const hits: Hit[] = []
  for (const pattern of patterns) {
    if (pattern.lang !== undefined && pattern.lang !== lang) continue
    const matches = [...(pattern.isProseOnly ? prose : text).matchAll(pattern.regex)].filter(match => !isAllowed(pattern, match[0]))
    if (matches.length === 0) continue
    const first = matches[0]!
    const counted = Math.min(matches.length, pattern.cap ?? 3)
    hits.push({
      id: pattern.id,
      label: pattern.label,
      tier: pattern.tier,
      count: matches.length,
      example: snippet(text, first.index ?? 0, first[0].length),
      points: counted * pattern.weight,
      phrases: [...new Set(matches.map(match => match[0].toLowerCase().trim()))],
    })
  }

  const points = hits.reduce((total, hit) => total + hit.points, 0)
  // Short texts (an Edit's new lines) are scored as if 150 words long, so one
  // phrase in a sentence does not read as saturation.
  const density = (points / Math.max(wordCount, 150)) * 1000

  return {
    words: wordCount,
    lang,
    points,
    score: Math.round(100 * Math.exp(-density / 40)),
    hits: hits.sort((a, b) => b.points - a.points),
    hard: hits.filter(hit => hit.tier === 'hard'),
    distinct: new Set(hits.filter(hit => hit.tier !== 'hard').flatMap(hit => hit.phrases.map(phrase => `${hit.id}:${phrase}`))).size,
  }
}

export type Verdict = 'pass' | 'block'

export function verdict(report: Report, threshold: number, minTells: number): Verdict {
  if (report.hard.length > 0) return 'block'
  return report.score < threshold && report.distinct >= minTells ? 'block' : 'pass'
}

export function explain(report: Report, path: string): string {
  const lines = report.hits.map(hit => {
    const times = hit.count > 1 ? ` (${hit.count}x)` : ''
    const tag = hit.tier === 'hard' ? ' [always blocked]' : ''
    return `- ${hit.label}${times}${tag}: "${hit.example}"`
  })

  return [
    `Slop Filter stopped this write to ${path}: slop score ${report.score}/100 (${report.lang === 'es' ? 'Spanish' : 'English'}, ${report.words} words).`,
    ...lines,
    'Rewrite the copy in plain, specific language: say the concrete fact, number or example instead of the stock phrase, drop the flagged words, and keep every fact, keyword and link. Then write it again.',
  ].join('\n')
}
