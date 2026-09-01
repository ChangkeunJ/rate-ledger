import { useEffect, useState } from 'react'

type Counts = { brands: number; products: number; rates_open: number; deposit: number; lending: number }
type Health = { finished_at: string; brands_ok: number; brands_total: number; failures: number } | null
type Best = { brand: string; product: string; rate_type: string; term: string | null; rate: string; from_at: string; purpose: string | null; repay: string | null; info: string | null }
type Move = { brand: string; product: string; kind: string; rate_type: string; term: string | null; was: string; now: string; moved_at: string }
type Bank = { name: string; industries: string[]; products: string; last_ok: string | null; last_err: string | null }

const CATS = [
  { id: 'TERM_DEPOSITS', kind: 'deposit', label: 'Term deposits' },
  { id: 'TRANS_AND_SAVINGS_ACCOUNTS', kind: 'deposit', label: 'Savings' },
  { id: 'RESIDENTIAL_MORTGAGES', kind: 'lending', label: 'Home loans' },
  { id: 'PERS_LOANS', kind: 'lending', label: 'Personal loans' },
  { id: 'BUSINESS_LOANS', kind: 'lending', label: 'Business loans' },
  { id: 'CRED_AND_CHRG_CARDS', kind: 'lending', label: 'Credit cards' },
]
const MONTHS = [1, 3, 6, 9, 12, 24, 36, 60]
const TABS = ['rates', 'moves', 'banks'] as const

function useJson<T>(url: string) {
  const [v, setV] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    setV(null)
    setErr(null)
    fetch(url, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setV, (e) => e.name !== 'AbortError' && setErr(String(e.message)))
    return () => ac.abort()
  }, [url])
  return { v, err }
}

const pct = (r: string | number) => (Number(r) * 100).toFixed(2) + '%'
const num = (n: number | string) => Number(n).toLocaleString('en-AU')

// Rounds down, so a rate read four hours ago reads "today".
function ago(iso: string | null) {
  if (!iso) return '—'
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400e3)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

function term(t: string | null) {
  if (!t) return '—'
  const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?/.exec(t)
  if (!m) return t
  const n = Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0) + Math.floor(Number(m[3] ?? 0) / 30)
  return n % 12 === 0 && n >= 12 ? `${n / 12} yr` : `${n} mo`
}

function Strip({ counts, health }: { counts: Counts | null; health: Health }) {
  const cells: [string, string][] = [
    ['Banks', counts ? num(counts.brands) : '—'],
    ['Products', counts ? num(counts.products) : '—'],
    ['Rates held', counts ? num(counts.rates_open) : '—'],
    ['Deposit / lending', counts ? `${num(counts.deposit)} / ${num(counts.lending)}` : '—'],
    ['Last read', health ? ago(health.finished_at) : '—'],
  ]
  return (
    <div className="strip">
      {cells.map(([k, v]) => (
        <div key={k} className="cell">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      {health && (
        <div className="cell">
          <span className="k">Reached</span>
          <span className="v">
            {health.brands_ok}/{health.brands_total}
            {health.failures > 0 && <em className="warn"> {health.failures} errors</em>}
          </span>
        </div>
      )}
    </div>
  )
}

function Rates() {
  const [cat, setCat] = useState(CATS[0])
  const [months, setMonths] = useState('12')
  const q = `/api/best?category=${cat.id}&kind=${cat.kind}` + (cat.id === 'TERM_DEPOSITS' && months ? `&months=${months}` : '')
  const { v, err } = useJson<Best[]>(q)
  return (
    <>
      <div className="bar">
        <select value={cat.id} onChange={(e) => setCat(CATS.find((c) => c.id === e.target.value)!)}>
          {CATS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        {cat.id === 'TERM_DEPOSITS' && (
          <select value={months} onChange={(e) => setMonths(e.target.value)}>
            <option value="">Any term</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>{m % 12 === 0 ? `${m / 12} year` : `${m} month`}</option>
            ))}
          </select>
        )}
        <p className="note">
          {cat.kind === 'deposit' ? 'Highest first.' : 'Lowest first.'} Advertised rates, not offers. Discounts and
          penalties are increments off another rate, so they are left out.
        </p>
      </div>
      {err && <p className="err">{err}</p>}
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Bank</th>
            <th>Product</th>
            <th>Type</th>
            <th>Term</th>
            <th className="r">Rate</th>
            <th>Held since</th>
          </tr>
        </thead>
        <tbody>
          {v?.map((r, i) => (
            <tr key={i}>
              <td className="rank">{i + 1}</td>
              <td className="name">{r.brand}</td>
              <td>
                {r.product}
                {r.purpose && <span className="tag">{r.purpose.replace(/_/g, ' ').toLowerCase()}</span>}
                {r.repay && <span className="tag">{r.repay === 'INTEREST_ONLY' ? 'interest only' : 'P&I'}</span>}
                {r.info && <span className="info" title={r.info}>{r.info}</span>}
              </td>
              <td className="dim">{r.rate_type.toLowerCase()}</td>
              <td className="dim">{term(r.term)}</td>
              <td className="r big">{pct(r.rate)}</td>
              <td className="dim">{ago(r.from_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {v && v.length === 0 && <p className="empty">Nothing published in this category today.</p>}
    </>
  )
}

function Moves() {
  const [days, setDays] = useState('7')
  const { v, err } = useJson<Move[]>(`/api/moves?days=${days}`)
  return (
    <>
      <div className="bar">
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          {['1', '7', '30', '90'].map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
        <p className="note">Every rate that moved, biggest move first.</p>
      </div>
      {err && <p className="err">{err}</p>}
      <table>
        <thead>
          <tr>
            <th>Bank</th>
            <th>Product</th>
            <th>Type</th>
            <th>Term</th>
            <th className="r">Was</th>
            <th className="r">Now</th>
            <th className="r">Change</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {v?.map((m, i) => {
            const d = Number(m.now) - Number(m.was)
            return (
              <tr key={i}>
                <td className="name">{m.brand}</td>
                <td>{m.product}</td>
                <td className="dim">{m.rate_type.toLowerCase()}</td>
                <td className="dim">{term(m.term)}</td>
                <td className="r dim">{pct(m.was)}</td>
                <td className="r big">{pct(m.now)}</td>
                <td className={'r ' + (d > 0 ? 'up' : 'down')}>{(d > 0 ? '+' : '') + (d * 100).toFixed(2)}</td>
                <td className="dim">{ago(m.moved_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {v && v.length === 0 && (
        <p className="empty">No move recorded in this window. The ledger compares each morning's read with the one before it, so the first moves show up a day after the first read.</p>
      )}
    </>
  )
}

function Banks() {
  const { v, err } = useJson<Bank[]>('/api/brands')
  const [f, setF] = useState('')
  const rows = v?.filter((b) => b.name.toLowerCase().includes(f.toLowerCase()))
  return (
    <>
      <div className="bar">
        <input placeholder="Filter by name" value={f} onChange={(e) => setF(e.target.value)} />
        <p className="note">Everyone on the CDR register that serves a product endpoint.</p>
      </div>
      {err && <p className="err">{err}</p>}
      <table>
        <thead>
          <tr>
            <th>Bank</th>
            <th>Industry</th>
            <th className="r">Products</th>
            <th>Last read</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((b) => (
            <tr key={b.name}>
              <td className="name">{b.name}</td>
              <td className="dim">{b.industries.join(', ').replace(/-/g, ' ')}</td>
              <td className="r">{num(b.products)}</td>
              <td className="dim">{ago(b.last_ok)}</td>
              <td className="err-cell">{b.last_err ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('rates')
  const { v: counts } = useJson<Counts>('/api/counts')
  const { v: health } = useJson<Health>('/api/health')
  return (
    <>
      <header>
        <div className="wrap">
          <h1>rate ledger</h1>
          <p className="thesis">
            Australian banks publish every advertised rate under the Consumer Data Right, and overwrite it the day
            it changes. This reads all of them each morning and keeps the dates each number held.
          </p>
          <Strip counts={counts} health={health} />
        </div>
      </header>
      <nav className="wrap">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'rates' ? 'Rates' : t === 'moves' ? 'Movements' : 'Banks'}
          </button>
        ))}
      </nav>
      <main className="wrap">
        {tab === 'rates' && <Rates />}
        {tab === 'moves' && <Moves />}
        {tab === 'banks' && <Banks />}
      </main>
      <footer className="wrap">
        <p>
          Source data from the CDR Product Reference Data endpoints, licensed CC BY 4.0. Read once a day at 06:00
          Sydney. Advertised rates, not offers, and not advice. <a href="https://github.com/ChangkeunJ/rate-ledger">Code and daily snapshots</a>.
        </p>
      </footer>
    </>
  )
}
