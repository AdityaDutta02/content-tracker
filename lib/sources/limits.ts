// Source budget, social cap, and yield-based rotation.
//
// Social sources (IG/X/YT) each cost a paid gateway scrape per daily run, so the
// number of them is hard-capped. Across all source types we keep at most
// TOTAL_ACTIVE_BUDGET active per run, picking the highest-yield ones — a source
// that returned nothing last run drops into a cooldown and rotates back in later,
// so nothing is permanently lost and credits aren't spent on dead sources.
import type { SourceRow, SourceType } from '../types'

export const TOTAL_ACTIVE_BUDGET = 10
export const SOCIAL_BUDGET = 4
export const ROTATION_COOLDOWN_RUNS = 3

// Social = the paid, handle-based gateway scrapes. FB/LinkedIn are not scraped by
// this app at all (too pricey / low signal) — they're rejected at add time and
// skipped at fetch time.
export const SOCIAL_SOURCE_TYPES: ReadonlySet<SourceType> = new Set<SourceType>(['x', 'ig', 'yt'])
export const UNSUPPORTED_SOURCE_TYPES: ReadonlySet<SourceType> = new Set<SourceType>(['fb', 'linkedin'])

export class SourceLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceLimitError'
  }
}

const isEnabled = (s: SourceRow): boolean => s.enabled !== false

/**
 * Guard for adding a source. Rejects unsupported platforms outright and enforces
 * the social cap (counting only enabled social sources already on the channel).
 * Throws SourceLimitError with a user-facing message on violation.
 */
export function assertCanAddSource(type: SourceType, existing: SourceRow[]): void {
  if (UNSUPPORTED_SOURCE_TYPES.has(type)) {
    throw new SourceLimitError(`${type} sources aren't supported`)
  }
  if (SOCIAL_SOURCE_TYPES.has(type)) {
    const current = existing.filter((s) => isEnabled(s) && SOCIAL_SOURCE_TYPES.has(s.type)).length
    if (current >= SOCIAL_BUDGET) {
      throw new SourceLimitError(
        `At most ${SOCIAL_BUDGET} social sources (Instagram / X / YouTube) per channel — remove one first`,
      )
    }
  }
}

/** Cooldown to apply to a source given how many fresh items it produced. */
export function nextCooldown(yieldCount: number): number {
  return yieldCount > 0 ? 0 : ROTATION_COOLDOWN_RUNS
}

// New sources (no recorded yield) get top priority so they're always tried once.
const NEW_SOURCE_PRIORITY = Number.MAX_SAFE_INTEGER

const cooldownOf = (cfg: Record<string, unknown>): number => Number(cfg._cooldown ?? 0)

// Ranking is purely by last-run yield. A new source (no yield yet) ranks highest
// so it's always tried once; a 0-yield source ranks lowest and rotates out first
// when the budget is contested.
function priorityOf(s: SourceRow): number {
  const raw = (s.scrape_config ?? {})._yield
  if (raw === undefined || raw === null) return NEW_SOURCE_PRIORITY
  const y = Number(raw)
  return Number.isFinite(y) ? y : NEW_SOURCE_PRIORITY
}

const byYieldDesc = (a: SourceRow, b: SourceRow): number => priorityOf(b) - priorityOf(a)

/**
 * Pick the active source set for a run: at most TOTAL_ACTIVE_BUDGET sources
 * total, with up to SOCIAL_BUDGET slots RESERVED for social so a wide article
 * roster can't crowd social out. Within each bucket, highest last-run yield wins.
 *
 * Cooldown is asymmetric by cost:
 *   - Social (paid): a cooled-down source is STRICTLY benched — excluded from the
 *     run so a dead account stops burning credits, then auto-retried when its
 *     cooldown expires.
 *   - Article (free): never hard-benched — always fetched when a slot is free,
 *     and only rotated out by yield when more than 10 sources compete.
 */
export function selectActiveSources(sources: SourceRow[]): SourceRow[] {
  const eligible = sources.filter((s) => isEnabled(s) && !UNSUPPORTED_SOURCE_TYPES.has(s.type))

  const social = eligible
    .filter((s) => SOCIAL_SOURCE_TYPES.has(s.type) && cooldownOf(s.scrape_config ?? {}) === 0)
    .sort(byYieldDesc)
    .slice(0, SOCIAL_BUDGET)

  const articleSlots = Math.max(0, TOTAL_ACTIVE_BUDGET - social.length)
  const article = eligible
    .filter((s) => !SOCIAL_SOURCE_TYPES.has(s.type))
    .sort(byYieldDesc)
    .slice(0, articleSlots)

  return [...social, ...article]
}
