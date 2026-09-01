import { Http, brands, products, detail, sleep } from './cdr.js'
import type { Brand } from './cdr.js'
import * as db from './db.js'

const LANES = Number(process.env.LANES ?? 8)
const GAP = Number(process.env.GAP_MS ?? 120)

type Fail = { brand: string; base: string; step: string; err: string }

async function one(http: Http, pool: db.Pool, b: Brand, at: Date, fails: Fail[]) {
  await db.putBrand(pool, b)
  let list: any[]
  try {
    list = await products(http, b)
  } catch (e: any) {
    fails.push({ brand: b.name, base: b.base, step: 'list', err: String(e.message ?? e).slice(0, 200) })
    await db.markBrand(pool, b.id, String(e.message ?? e))
    return null
  }

  let n = 0, opened = 0, closed = 0
  for (const p of list) {
    try {
      const d = await detail(http, b, p.productId)
      await db.putProduct(pool, b.id, d, at)
      const [o, c] = await db.syncRates(pool, b.id, d.pid, d.rates, at)
      opened += o
      closed += c
      n++
    } catch (e: any) {
      // One bad product must not lose the other 160 this holder serves.
      fails.push({ brand: b.name, base: b.base, step: `detail ${p.productId}`, err: String(e.message ?? e).slice(0, 200) })
    }
    await sleep(GAP)
  }
  await db.retire(pool, b.id, at)
  await db.markBrand(pool, b.id, null)
  return { n, opened, closed }
}

async function main() {
  const at = new Date()
  const http = new Http()
  const pool = db.pool()
  const all = await brands(http)
  const runId = await db.startRun(pool, at, all.length)
  console.log(`${all.length} brands`)

  const fails: Fail[] = []
  let ok = 0, seen = 0, opened = 0, closed = 0
  let i = 0

  // One lane per holder, not per request: a slow bank must not stall the others,
  // and no bank sees more than one request at a time from us.
  const lane = async () => {
    for (;;) {
      const b = all[i++]
      if (!b) return
      const t = Date.now()
      try {
        const r = await one(http, pool, b, at, fails)
        if (!r) {
          console.log(`  ${b.name} — list failed (${Date.now() - t}ms)`)
          continue
        }
        ok++
        seen += r.n
        opened += r.opened
        closed += r.closed
        console.log(`  ${b.name} — ${r.n} products, +${r.opened}/-${r.closed} (${Date.now() - t}ms)`)
      } catch (e: any) {
        fails.push({ brand: b.name, base: b.base, step: 'brand', err: String(e.message ?? e).slice(0, 200) })
      }
    }
  }
  await Promise.all(Array.from({ length: LANES }, lane))

  await db.endRun(pool, runId, { ok, products: seen, opened, closed, failures: fails })
  console.log(`\n${ok}/${all.length} brands, ${seen} products, ${opened} opened, ${closed} closed, ${fails.length} failures`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
