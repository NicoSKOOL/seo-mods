# SEO Mods for Claude Code

Three Claude Code mods for SEO work: live rankings while Claude works, a guard against keyword cannibalization, and a filter that keeps AI slop off your pages.

- **Client Pulse:** a band above the prompt showing the client's Search Console clicks and impressions (week over week), tracked keyword movement, AI citations and the top opportunity query.
- **Cannibalization Guard:** stops Claude from creating a new page for a keyword your site already covers or ranks for, and tells it to improve the existing page instead.
- **Slop Filter:** scores every page Claude writes for AI tells and SEO cliches ("look no further", "nestled in the heart of", "it's not just X, it's Y"), in English and Spanish, and makes Claude rewrite anything that reads like AI. No data source needed, no tokens used.

Client Pulse and Cannibalization Guard read their data from [DataWise SEO](https://www.datawiseseo.com/) through its Claude connector.

## Requirements

- **Claude Code:** a recent version (mods are new; run `claude update`).
- **DataWise SEO:** connected in Claude, with your client's Search Console property synced.
- **DataForSEO (optional):** the Guard's "which URL already ranks" lookup uses ranked keywords through DataWise, about one call per domain per day. [Get DataForSEO here](https://app.dataforseo.com/?aff=182182).

## Install

In a Claude Code terminal session:

```
/plugin install client-pulse --marketplace NicoSKOOL/seo-mods
/plugin install cannibal-guard --marketplace NicoSKOOL/seo-mods
/plugin install slop-filter --marketplace NicoSKOOL/seo-mods
```

Answer `y` to add the marketplace, then choose the user scope.

## Set up a client project

Put a `.seo-client.json` in the root of each client's website project:

```json
{ "domain": "example.com" }
```

Optional fields:

| Field | What it does |
| --- | --- |
| `locationCode`, `languageCode` | DataForSEO market for ranked keywords (for example `2152` and `es` for Chile) |
| `contentDirs` | Folders holding your pages (default: `src/content`, `src/pages`, `content`, `pages`) |
| `cannibalization.minImpressions` | Search Console impressions before a keyword counts as taken (default 20) |
| `cannibalization.rankedKeywords` | `false` to skip the DataForSEO lookup |
| `datawiseServer` | The DataWise connector's name if `/mcp` shows a different one (default `claude.ai DataWise SEO`) |

## Using Client Pulse

Open Claude Code in the client project and the band appears. Data is cached for 6 hours.

- `/pulse` refreshes the numbers and shares them with Claude.
- `/pulse otherclient.com` switches client.
- `×` hides the band.

## Using Cannibalization Guard

The Guard checks new pages that declare a target keyword, in any of these forms:

```
---
keyword: emergency dentist austin
---
```

`const keyword = "emergency dentist austin"` in an Astro file, or `<!-- keyword: emergency dentist austin -->` in HTML.

Add this line to your project's CLAUDE.md so every new page gets one:

> Every new page gets a `keyword:` field in its frontmatter with its primary target keyword.

When the Guard blocks a page, Claude explains what already covers the keyword. If you still want the new page, tell Claude, and it adds `cannibalization: ok` to the frontmatter.

## Using Slop Filter

It works out of the box. Every time Claude writes or edits website copy (`.astro`, `.html`, `.mdx`, and `.md` inside your content folders), the filter scores the new text from 0 to 100:

- **Always blocked:** leftover chatbot text ("Here's the revised version"), citation junk (`oaicite`, `utm_source=chatgpt.com`) and unfilled placeholders like `[Your Phone Number]`.
- **Blocked when it piles up:** AI vocabulary (delve, tapestry, nestled, vibrant), stock openers ("In today's fast-paced world"), SEO cliches ("look no further", "your trusted partner", "seamless"), "it's not just X, it's Y", "In conclusion" sections, and in Spanish "cabe destacar", "juega un papel fundamental" and Title Case Headings. One "crucial" proves nothing, so a page is only blocked when the score drops under 60 and at least 3 different tells show up.

When it blocks, Claude gets the list of tells with examples and rewrites the copy. The status line shows each page's score. If Claude cannot get a page under the bar in two tries, the third write goes through with a warning, so it never loops.

Tune it under `slop` in `.seo-client.json`:

```json
{
  "slop": {
    "threshold": 60,
    "minTells": 3,
    "mode": "block",
    "banned": ["leading provider", "state-of-the-art"],
    "allow": ["Heart of Texas"],
    "emDash": "block"
  }
}
```

| Field | What it does |
| --- | --- |
| `threshold` | Score below which a page is blocked (default 60) |
| `minTells` | Different tells needed before a block (default 3) |
| `mode` | `warn` writes the page and only flags it to Claude |
| `banned` | Your own phrases that always block |
| `allow` | Names or phrases never to flag (a business name like "Vibrant Smiles") |
| `emDash` | `block`, `count` (default) or `off` |

To publish a page anyway, tell Claude, and it adds `slop: ok` to the frontmatter.

Patterns draw on Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [slop-score](https://github.com/sam-paech/slop-score) and [slop-guard](https://github.com/eric-tramel/slop-guard).
