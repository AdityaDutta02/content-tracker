import { NextRequest, NextResponse } from 'next/server'
import { dbList, dbDelete } from '@/lib/db'
import { getEmbedToken } from '@/lib/auth'

// 30-day retention. Runs daily at 3am UTC.
// Items are inline on runs.items_json now, so purging runs purges items too.
// db SDK has no bulk filter; iterate list+delete. Acceptable at expected volume.
const ITEM_RETENTION_DAYS = 30
const RUN_RETENTION_DAYS = 30

export async function POST(req: NextRequest) {
  try {
    const token = getEmbedToken(req)
    const itemCutoff = Date.now() - ITEM_RETENTION_DAYS * 86400_000
    const runCutoff = Date.now() - RUN_RETENTION_DAYS * 86400_000

    const items = await dbList<{ id: string; created_at: string }>('items', {}, token)
    const itemDel = items.filter((i) => new Date(i.created_at).getTime() < itemCutoff)
    let itemsDeleted = 0
    for (const i of itemDel) {
      try {
        await dbDelete('items', i.id, token)
        itemsDeleted++
      } catch {
        /* skip */
      }
    }

    const runs = await dbList<{ id: string; run_at: string }>('runs', {}, token)
    const runDel = runs.filter((r) => new Date(r.run_at).getTime() < runCutoff)
    let runsDeleted = 0
    for (const r of runDel) {
      try {
        await dbDelete('runs', r.id, token)
        runsDeleted++
      } catch {
        /* skip */
      }
    }

    return NextResponse.json({ items_deleted: itemsDeleted, runs_deleted: runsDeleted })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'purge failed' }, { status: 500 })
  }
}
