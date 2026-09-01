import { neon } from '@neondatabase/serverless'
import * as Q from '../src/queries'

interface Env {
  DATABASE_URL: string
  ASSETS: { fetch(req: Request): Promise<Response> }
}

// Anything the assets binding did not already answer lands here, so the only
// paths that reach this worker are /api/* and typos.
const routes: Record<string, (q: Q.Q, p: URLSearchParams) => Promise<unknown>> = {
  '/api/health': async (q) => (await Q.health(q))[0] ?? null,
  '/api/counts': async (q) => (await Q.counts(q))[0],
  '/api/brands': (q) => Q.brands(q),
  '/api/best': (q, p) =>
    Q.best(q, p.get('category') ?? 'TERM_DEPOSITS', p.get('kind') ?? 'deposit',
           p.get('months') ? Number(p.get('months')) : null, p.get('at')),
  '/api/moves': (q, p) => Q.moves(q, Math.min(Number(p.get('days') ?? 7), 90)),
  '/api/history': (q, p) => Q.history(q, p.get('brand') ?? '', p.get('pid') ?? ''),
  '/api/cash': (q) => Q.cash(q),
  '/api/spread': (q) => Q.spread(q),
  '/api/passthrough': (q, p) => Q.passthrough(q, p.get('at'), Math.min(Number(p.get('days') ?? 60), 180)),
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // The numbers move once a day, at 06:00 Sydney.
      'cache-control': status === 200 ? 'public, max-age=300, s-maxage=900' : 'no-store',
    },
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url)
    const fn = routes[u.pathname]
    if (!fn) {
      if (!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
      return json({ error: 'not found', routes: Object.keys(routes) }, 404)
    }
    const sql = neon(env.DATABASE_URL)
    const q: Q.Q = (text, args) => sql.query(text, args) as Promise<any[]>
    try {
      return json(await fn(q, u.searchParams))
    } catch (e: any) {
      return json({ error: String(e?.message ?? e) }, 500)
    }
  },
}
