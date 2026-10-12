# SEO Mods for Claude Code

Two Claude Code mods that give Claude live access to your rankings while it works.

- **Client Pulse:** a band above the prompt showing the client's Search Console clicks and impressions (week over week), tracked keyword movement, AI citations and the top opportunity query.
- **Cannibalization Guard:** stops Claude from creating a new page for a keyword your site already covers or ranks for, and tells it to improve the existing page instead.

Both read their data from [DataWise SEO](https://www.datawiseseo.com/) through its Claude connector.

## Requirements

- **Claude Code:** a recent version (mods are new; run `claude update`).
- **DataWise SEO:** connected in Claude, with your client's Search Console property synced.
- **DataForSEO (optional):** the Guard's "which URL already ranks" lookup uses ranked keywords through DataWise, about one call per domain per day. [Get DataForSEO here](https://app.dataforseo.com/?aff=182182).

## Install

In a Claude Code terminal session:

```
/plugin install client-pulse --marketplace NicoSKOOL/seo-mods
/plugin install cannibal-guard --marketplace NicoSKOOL/seo-mods
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
