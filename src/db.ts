import pg from 'pg'
import type { Brand, Detail, Rate } from './cdr.js'
import { rateKey } from './cdr.js'

export type Pool = pg.Pool

export function pool(url = process.env.DATABASE_URL): Pool {
  if (!url) throw new Error('DATABASE_URL is not set')
  return new pg.Pool({ connectionString: url, max: 8 })
}

export async function putBrand(db: Pool, b: Brand) {
  await db.query(
    `insert into brand (id, name, abn, industries, base_uri, logo_uri)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set
       name = excluded.name, abn = excluded.abn, industries = excluded.industries,
       base_uri = excluded.base_uri, logo_uri = excluded.logo_uri`,
    [b.id, b.name, b.abn, b.industries, b.base, b.logo],
  )
}

export async function markBrand(db: Pool, id: string, err: string | null) {
  await db.query(
    err ? `update brand set last_err = $2 where id = $1`
        : `update brand set last_ok = now(), last_err = null where id = $1`,
    err ? [id, err.replace(/\s+/g, ' ').slice(0, 200)] : [id],
  )
}

export async function putDecisions(db: Pool, rows: { at: string; change: number | null; target: number; raw: string }[]) {
  for (const d of rows) {
    await db.query(
      `insert into cash_rate (at, change, target, raw) values ($1,$2,$3,$4)
       on conflict (at) do update set change = excluded.change, target = excluded.target, raw = excluded.raw`,
      [d.at, d.change, d.target, d.raw],
    )
  }
}

export async function putProduct(db: Pool, brandId: string, d: Detail, at: Date) {
  await db.query(
    `insert into product (brand_id, pid, category, name, descr, tailored, updated, first_seen, last_seen)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     on conflict (brand_id, pid) do update set
       category = excluded.category, name = excluded.name, descr = excluded.descr,
       tailored = excluded.tailored, updated = excluded.updated,
       last_seen = excluded.last_seen, gone_at = null`,
    [brandId, d.pid, d.category, d.name, d.descr, d.tailored, d.updated, at],
  )
}

// Closes the intervals whose number moved, opens one for each new number, and
// leaves untouched rates alone. Returns [opened, closed].
export async function syncRates(db: Pool, brandId: string, pid: string, rates: Rate[], at: Date) {
  const c = await db.connect()
  try {
    await c.query('begin')
    const { rows: open } = await c.query(
      `select id, key, rate from rate where brand_id = $1 and pid = $2 and to_at is null for update`,
      [brandId, pid],
    )
    const held = new Map(open.map((r) => [r.key as string, r]))
    const seen = new Set<string>()
    let opened = 0
    let closed = 0

    for (const r of rates) {
      const key = rateKey(r)
      if (seen.has(key)) continue
      seen.add(key)
      const cur = held.get(key)
      if (cur && Number(cur.rate) === r.rate) continue
      if (cur) {
        await c.query(`update rate set to_at = $2 where id = $1`, [cur.id, at])
        closed++
      }
      await c.query(
        `insert into rate (brand_id, pid, kind, rate_type, term, key, rate, detail, from_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [brandId, pid, r.kind, r.rateType, r.term, key, r.rate, JSON.stringify(r.detail), at],
      )
      opened++
    }

    for (const [key, row] of held) {
      if (seen.has(key)) continue
      await c.query(`update rate set to_at = $2 where id = $1`, [row.id, at])
      closed++
    }

    await c.query('commit')
    return [opened, closed] as const
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

// Anything the holder stopped listing this run. Closing the rates too keeps
// "what was on offer on date X" answerable with one predicate.
export async function retire(db: Pool, brandId: string, at: Date) {
  const { rowCount } = await db.query(
    `update product set gone_at = $2 where brand_id = $1 and last_seen < $2 and gone_at is null`,
    [brandId, at],
  )
  await db.query(
    `update rate r set to_at = $2 from product p
      where r.brand_id = p.brand_id and r.pid = p.pid
        and p.brand_id = $1 and p.gone_at is not null and r.to_at is null`,
    [brandId, at],
  )
  return rowCount ?? 0
}

export async function startRun(db: Pool, at: Date, total: number) {
  const { rows } = await db.query(
    `insert into run (started_at, brands_total) values ($1,$2) returning id`, [at, total])
  return rows[0].id as number
}

export async function endRun(db: Pool, id: number, s: {
  ok: number; products: number; opened: number; closed: number; failures: unknown[]
}) {
  await db.query(
    `update run set finished_at = now(), brands_ok = $2, products_seen = $3,
            opened = $4, closed = $5, failures = $6 where id = $1`,
    [id, s.ok, s.products, s.opened, s.closed, JSON.stringify(s.failures)],
  )
}
