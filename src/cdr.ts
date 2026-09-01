import { createHash } from 'node:crypto'

// Client for the CDR public product endpoints. Every holder serves a different
// slice of the standard's versions, so each call negotiates with x-min-v.
const REGISTER = 'https://api.cdr.gov.au/cdr-register/v1/all/data-holders/brands/summary'

export type Brand = {
  id: string
  name: string
  abn: string | null
  industries: string[]
  base: string
  logo: string | null
}

export type Rate = {
  kind: 'deposit' | 'lending'
  rateType: string
  rate: number
  term: string | null
  detail: unknown
}

export type Detail = {
  pid: string
  category: string
  name: string
  descr: string | null
  tailored: boolean
  updated: string | null
  rates: Rate[]
}

export class Http {
  constructor(private ua = 'rate-ledger/0.1 (+https://github.com/ChangkeunJ/rate-ledger)') {}

  // A holder that cannot serve the asked range answers 406 and names a version it
  // does support in the x-v header. Asking high with x-min-v covers most of them;
  // the named version covers the rest.
  async json(url: string, maxV = 10, tries = 3): Promise<{ body: any; v: string | null }> {
    let last: Error | null = null
    let pin: string | null = null
    for (let i = 0; i < tries; i++) {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 30_000)
      try {
        const h: Record<string, string> = { accept: 'application/json', 'user-agent': this.ua }
        if (pin) h['x-v'] = pin
        else {
          h['x-v'] = String(maxV)
          h['x-min-v'] = '1'
        }
        const r = await fetch(url, { signal: ac.signal, headers: h })
        if (r.status === 406 && !pin) {
          const said = r.headers.get('x-v')
          if (said && /^\d+$/.test(said)) {
            pin = said
            continue
          }
        }
        if (r.status === 429 || r.status >= 500) throw new Error(`${r.status} ${r.statusText}`)
        if (!r.ok) {
          const b = await r.text()
          throw Object.assign(new Error(`${r.status} ${b.slice(0, 160)}`), { fatal: true })
        }
        return { body: await r.json(), v: r.headers.get('x-v') }
      } catch (e: any) {
        last = e
        if (e.fatal) break
        await sleep(400 * 2 ** i + Math.floor(Math.random() * 200))
      } finally {
        clearTimeout(t)
      }
    }
    throw last ?? new Error('unreachable')
  }
}

export async function brands(http: Http): Promise<Brand[]> {
  const { body } = await http.json(REGISTER, 3)
  return body.data
    .filter((b: any) => b.industries.some((i: string) => i === 'banking' || i === 'non-bank-lending'))
    .map((b: any) => ({
      id: b.dataHolderBrandId,
      name: b.brandName,
      abn: b.abn ?? null,
      industries: b.industries,
      base: String(b.productBaseUri || b.publicBaseUri || '').replace(/\/+$/, ''),
      logo: b.logoUri ?? null,
    }))
    .filter((b: Brand) => b.id && b.base)
}

// Lists every product for one holder. `since` turns the daily pass into a delta,
// but a holder that ignores it just returns everything, which still works.
export async function products(http: Http, b: Brand, since?: Date): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 40; page++) {
    const u = new URL(b.base + '/cds-au/v1/banking/products')
    u.searchParams.set('page-size', '250')
    u.searchParams.set('page', String(page))
    if (since) u.searchParams.set('updated-since', since.toISOString())
    const { body } = await http.json(u.toString())
    const got = body?.data?.products ?? []
    out.push(...got)
    const total = body?.meta?.totalPages ?? 1
    if (page >= total || got.length === 0) break
  }
  return out
}

export async function detail(http: Http, b: Brand, pid: string): Promise<Detail> {
  const { body } = await http.json(`${b.base}/cds-au/v1/banking/products/${encodeURIComponent(pid)}`)
  const d = body.data
  return {
    pid: d.productId,
    category: d.productCategory ?? 'UNKNOWN',
    name: d.name ?? '',
    descr: d.description ?? null,
    tailored: !!d.isTailored,
    updated: d.lastUpdated ?? null,
    rates: [...pick(d.depositRates, 'deposit'), ...pick(d.lendingRates, 'lending')],
  }
}

function pick(rows: any[] | undefined, kind: 'deposit' | 'lending'): Rate[] {
  if (!Array.isArray(rows)) return []
  const out: Rate[] = []
  for (const r of rows) {
    const rate = Number(r.rate)
    if (!Number.isFinite(rate)) continue
    out.push({
      kind,
      rateType: r.depositRateType ?? r.lendingRateType ?? 'UNKNOWN',
      rate,
      term: r.additionalValue ?? null,
      detail: {
        tiers: r.tiers ?? null,
        calc: r.calculationFrequency ?? null,
        app: r.applicationFrequency ?? null,
        info: r.additionalInfo ?? null,
        loanPurpose: r.loanPurpose ?? null,
        repayType: r.repaymentType ?? null,
        interestType: r.interestPaymentDue ?? null,
      },
    })
  }
  return out
}

// A rate's identity across days. Type and term do not separate them on their own
// (ING lists three OWNER_OCCUPIED/P&I variable rates at one price, split by LVR
// band), so the tier set discriminates.
export function rateKey(r: Rate): string {
  const d = r.detail as any
  const p = [d?.loanPurpose, d?.repayType].filter(Boolean).join('/')
  return [r.kind, r.rateType, r.term ?? '-', p || '-', hash(canon(d?.tiers ?? null))].join('|')
}

// ING returns the same two tiers as [LVR, borrowing] on one replica and
// [borrowing, LVR] on another, so member order must not reach the hash.
export function canon(v: unknown): string {
  if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return '[' + v.map(canon).sort().join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
}

// 21k keys in a 32-bit space collide about 5% of the time. 48 bits does not.
function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
