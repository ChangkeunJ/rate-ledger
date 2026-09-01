import { createServer } from 'node:http'
import { pool } from './db.js'

const db = pool()
const PORT = Number(process.env.PORT ?? 8080)

// Every route answers from open intervals unless it is given a date, in which
// case one predicate covers the whole history.
const routes: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  '/health': async () => {
    const { rows } = await db.query(
      `select id, started_at, finished_at, brands_ok, brands_total, products_seen,
              opened, closed, jsonb_array_length(failures) as failures
         from run order by id desc limit 1`)
    return rows[0] ?? { note: 'no run yet' }
  },

  '/best': async (q) => {
    const cat = q.get('category') ?? 'TERM_DEPOSITS'
    const kind = q.get('kind') ?? 'deposit'
    const term = q.get('term')
    const at = q.get('at')
    const { rows } = await db.query(
      `select b.name as brand, p.name as product, r.rate_type, r.term,
              r.rate, r.from_at, r.detail->'tiers' as tiers
         from rate r
         join product p on (p.brand_id, p.pid) = (r.brand_id, r.pid)
         join brand b on b.id = r.brand_id
        where p.category = $1 and r.kind = $2
          and ($3::text is null or r.term = $3)
          and ($4::timestamptz is null
               or (r.from_at <= $4 and (r.to_at is null or r.to_at > $4)))
          and ($4::timestamptz is not null or r.to_at is null)
        order by r.rate desc limit 25`,
      [cat, kind, term, at])
    return rows
  },

  '/moves': async (q) => {
    const days = Math.min(Number(q.get('days') ?? 7), 90)
    const { rows } = await db.query(
      `select b.name as brand, p.name as product, p.category, r.kind, r.rate_type, r.term,
              prev.rate as was, r.rate as now, r.from_at as moved_at
         from rate r
         join product p on (p.brand_id, p.pid) = (r.brand_id, r.pid)
         join brand b on b.id = r.brand_id
         join lateral (
           select rate from rate o
            where o.brand_id = r.brand_id and o.pid = r.pid and o.key = r.key
              and o.to_at = r.from_at
            order by o.to_at desc limit 1) prev on true
        where r.from_at > now() - ($1 || ' days')::interval
        order by abs(r.rate - prev.rate) desc, r.from_at desc limit 200`,
      [days])
    return rows
  },

  '/brands': async () => {
    const { rows } = await db.query(
      `select b.name, b.industries, b.last_ok, b.last_err,
              count(p.pid) filter (where p.gone_at is null) as products
         from brand b left join product p on p.brand_id = b.id
        group by b.id order by products desc, b.name`)
    return rows
  },
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x')
  const fn = routes[u.pathname]
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('access-control-allow-origin', '*')
  if (!fn) {
    res.writeHead(404).end(JSON.stringify({ error: 'not found', routes: Object.keys(routes) }))
    return
  }
  try {
    res.end(JSON.stringify(await fn(u.searchParams), null, 1))
  } catch (e: any) {
    res.writeHead(500).end(JSON.stringify({ error: String(e.message ?? e) }))
  }
}).listen(PORT, () => console.log(`listening on ${PORT}`))
