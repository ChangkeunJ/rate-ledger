import { writeFileSync, mkdirSync } from 'node:fs'
import { pool } from './db.js'
import { counts, health, moves, best } from './queries.js'

// Written into the repo after every scheduled run. It is the public record, and
// it is also what keeps GitHub from disabling the schedule after 60 quiet days.
async function main() {
  const db = pool()
  const q = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rows
  const [h] = await health(q)
  const [c] = await counts(q)
  const day = new Date().toISOString().slice(0, 10)

  const out = {
    date: day,
    run: h ? {
      started: h.started_at, finished: h.finished_at,
      brands: `${h.brands_ok}/${h.brands_total}`,
      products: h.products_seen, opened: h.opened, closed: h.closed, failures: h.failures,
    } : null,
    totals: c,
    moves: (await moves(q, 1, 40)).map((m) => ({
      brand: m.brand, product: m.product, kind: m.kind, term: m.term,
      was: Number(m.was), now: Number(m.now),
    })),
    best: {
      term_deposit_1y: (await best(q, 'TERM_DEPOSITS', 'deposit', 12, null))
        .slice(0, 5).map((r) => ({ brand: r.brand, product: r.product, rate: Number(r.rate) })),
      savings: (await best(q, 'TRANS_AND_SAVINGS_ACCOUNTS', 'deposit', null, null))
        .slice(0, 5).map((r) => ({ brand: r.brand, product: r.product, rate: Number(r.rate) })),
    },
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(`data/${day}.json`, JSON.stringify(out, null, 1) + '\n')
  writeFileSync('data/latest.json', JSON.stringify(out, null, 1) + '\n')
  console.log(`${day}: ${out.totals.rates_open} open, ${out.moves.length} moves`)
  await db.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
