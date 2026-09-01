import { createServer } from 'node:http'
import { pool } from './db.js'
import * as Q from './queries.js'

const db = pool()
const PORT = Number(process.env.PORT ?? 8080)
const q = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rows

const routes: Record<string, (p: URLSearchParams) => Promise<unknown>> = {
  '/api/health': async () => (await Q.health(q))[0] ?? { note: 'no run yet' },
  '/api/counts': async () => (await Q.counts(q))[0],
  '/api/brands': () => Q.brands(q),
  '/api/best': (p) => Q.best(q, p.get('category') ?? 'TERM_DEPOSITS', p.get('kind') ?? 'deposit', p.get('months') ? Number(p.get('months')) : null, p.get('at')),
  '/api/moves': (p) => Q.moves(q, Math.min(Number(p.get('days') ?? 7), 90)),
  '/api/cash': () => Q.cash(q),
  '/api/spread': () => Q.spread(q),
  '/api/passthrough': (p) => Q.passthrough(q, p.get('at'), Math.min(Number(p.get('days') ?? 60), 180)),
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
