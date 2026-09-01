import { pool, putDecisions } from './db.js'

// Table A2 is the RBA's own record of every cash rate decision since 1990. It is
// a spreadsheet export: nine header lines, then one line per announcement.
const A2 = 'https://www.rba.gov.au/statistics/tables/csv/a2-data.csv'

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')

export type Decision = { at: string; change: number | null; target: number; raw: string }

// Until 1998 the target was announced as a range and those rows still read
// "17.00 to 17.50". The last number is the one the rate settled at; the line is
// kept as served so nothing is lost to the parse.
export function parse(csv: string): Decision[] {
  const out: Decision[] = []
  for (const line of csv.split(/\r?\n/)) {
    const c = line.split(',')
    const at = day(c[0] ?? '')
    if (!at || !c[2]) continue
    const target = last(c[2])
    if (target === null) continue
    const ch = last(c[1] ?? '')
    out.push({ at, change: ch === null ? null : ch / 100, target: target / 100, raw: `${c[1]},${c[2]}` })
  }
  return out
}

// 23-Jan-1990
function day(s: string): string | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim())
  if (!m) return null
  const i = MONTHS.indexOf(m[2]!.toLowerCase())
  return i < 0 ? null : `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[1]}`
}

function last(s: string): number | null {
  const n = s.match(/-?\d+(\.\d+)?/g)
  return n ? Number(n[n.length - 1]) : null
}

async function main() {
  const r = await fetch(A2, { headers: { 'user-agent': 'rate-ledger (github.com/ChangkeunJ/rate-ledger)' } })
  if (!r.ok) throw new Error(`${A2} answered ${r.status}`)
  const rows = parse(await r.text())
  if (rows.length < 90) throw new Error(`only ${rows.length} decisions parsed, the table shape changed`)
  const db = pool()
  await putDecisions(db, rows)
  const now = rows[rows.length - 1]!
  console.log(`${rows.length} decisions, target ${(now.target * 100).toFixed(2)}% since ${now.at}`)
  await db.end()
}

if (process.argv[1]?.endsWith('rba.js')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
