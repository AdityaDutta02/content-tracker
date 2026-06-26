# Codebase Index — content-tracker (niche-wire)

Next.js 14 App Router. Terminal AI backend-as-a-service (per-app Postgres, embed-token
viewer auth, gateway AI/scrape/email/cron). ~3.9k LOC across lib/. Tests: tsx + node:test
(`npm test` = `node --import tsx --test "lib/**/*.test.ts"`).

## Data flow (one daily run)

```
cron /api/cron/daily ─► runChannelPipeline(channel, taskToken)        [lib/pipeline.ts]
  guards: hourInTz==10 + last_run_date != today  (once/day per channel)
  1. selectActiveSources(sources)        [limits.ts]  cap 10 total, 4 social reserved
  2. fetchSource(s, channel, token) each [sources/index.ts] → dispatch by type
  3. dedupe + looksLikeArticle backstop  [quality.ts]
  4. rankItems / clusterItems            [rank/]
  5. summarizeBatch (callGateway chat/fast) → 1 AI call/run
  6. dbInsert items + run; reconcileSources (yield/cooldown/web-silence write-back)
```

Add-source: detect route → `detectSource(input)` [detect.ts] → `assertCanAddSource` [limits.ts] → dbInsert.

## Source types & fetch paths  (lib/sources/index.ts → fetchSource)

| type | fetch fn | file | cost |
|---|---|---|---|
| rss | fetchRss | rss.ts | free |
| hn | fetchHn | hn.ts | free |
| reddit | fetchReddit | reddit.ts | free (rsshub/json) |
| arxiv | fetchArxiv | arxiv.ts | free |
| web | fetchWeb (cheerio→jina→firecrawl) | web.ts, jina.ts, firecrawl.ts | free / byok |
| **yt** | **fetchYoutubeNative** | **youtube.ts** | **free (public Atom RSS)** |
| ig | fetchSocial→instagram.posts | social-fetch.ts → scrape-sdk.ts | gateway, 11 cr |
| x | fetchSocial→twitter.tweets | social-fetch.ts → scrape-sdk.ts | gateway, 8 cr |
| fb / linkedin | return [] (not scraped) | — | — |

### YouTube = native RSS (NOT gateway)  [lib/sources/youtube.ts]
- Public Atom feed `youtube.com/feeds/videos.xml?channel_id=UC…` — no key, 0 credits, ~15 latest, newest-first. **Omits view/like engagement.**
- `resolveYoutubeChannelId(handle)` scrapes channel page once for the `UC…` id; cached.
- `fetchYoutubeNative(handle, knownChannelId?)` → resolves (if needed) then `fetchRss(feedUrl)`.
- detect.ts: resolves + caches `{fetch_tier:'native', channel_id, feed_url}` at add-time; health 'low' if unresolved (runtime retries).
- index.ts `yt` case: fetches via native, writes resolved `channel_id` back onto `source.scrape_config` so reconcileSources persists it (skips resolution hop next run).
- YT still counts toward the **4 social-source cap** (SOCIAL_SOURCE_TYPES) but costs 0.

## Source budget & rotation  [lib/sources/limits.ts]
- `TOTAL_ACTIVE_BUDGET=10`, `SOCIAL_BUDGET=4`, `ROTATION_COOLDOWN_RUNS=3`.
- `SOCIAL_SOURCE_TYPES={x,ig,yt}` (capped/benchable). `UNSUPPORTED={fb,linkedin}` (rejected at add).
- `assertCanAddSource` — reject fb/linkedin, block 5th enabled social.
- `selectActiveSources` — reserve ≤4 social slots (by yield, cooldown>0 social excluded), fill rest to 10 with article sources by yield. New sources (no _yield) rank highest.
- `nextCooldown(y)` = y>0 ? 0 : 3. Social hard-benched during cooldown (paid); article never hard-benched.

## Gateway SDK clients  [lib/scrape-sdk.ts]
`scrape<T>(platform, op, params, token)` — handles 402/403, inline-done + jobId-poll.
Clients: `instagram` (profile/posts/reels), `youtube` (channel/search — **unused now**, YT is native),
`twitter` (profile/tweets), `facebook`, `linkedin`. Lazy `gatewayUrl()` for testability.

## Costs (per once-daily run)
- ig 11, x 8 (gateway). yt/rss/web/reddit/hn/arxiv = 0. +1 AI summarize (chat/fast, ~1-3 cr).
- Refresh-run ceiling ~46 (4×ig). Detect/source-finding = 0 (pure local heuristics).

## Other lib
- types.ts — SourceType, FetchTier(`native|rsshub|apify|gateway`), FetchedItem, SourceRow, ChannelRow, DetectionResult.
- db.ts — dbList/Get/Insert/Update/Delete (gateway `/db/*`, embedToken Bearer).
- terminal-ai.ts — callGateway (AI), isSandbox. task-sdk.ts — createTask/listTasks/deleteTask.
- auth.ts — getEmbedToken (header Bearer or body.embedToken; throws NO_TOKEN). No shared secret → cron not externally triggerable.
- time.ts — dateInTz/hourInTz (tz-correct cron guards). canonical.ts — canonicalizeUrl (dedupe key).
- quality.ts — looksLikeArticle (runtime backstop), scoreSample (detect gate). rank/ — rankItems, clusterItems.

## API routes (app/api)
channels (CRUD + /refresh + /discover + /sources[/sid] + /detect), cron/daily, cron/purge,
items, runs, health. UI: app/c/[id] (feed), /sources/add, /discover-more, /c/new, /page.tsx.

## Related memory
[[niche-wire-deploy]] (app_id, deploy-from-main, hourly cron) · [[content-tracker-feed-quality]] (quality gates).
