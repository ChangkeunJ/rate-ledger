import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, putBrand, putProduct, putDecisions } from '../src/db.js'
import * as Q from '../src/queries.js'

const live = !!process.env.DATABASE_URL
const opts = live ? {} : { skip: 'DATABASE_URL not set' }
const db = live ? pool() : null
const q: Q.Q = async (sql, args) => (await db!.query(sql, args)).rows

const id = randomUUID()
const DEC = '2026-06-03'

// The categories are made up: the ranking is a top 25 over every holder, so a
// fixture in a real category would be buried under real rates.
before(async () => {
  if (!db) return
  await putBrand(db, { id, name: 'Read Bank', abn: null, industries: ['banking'], base: 'https://x', logo: null })
  for (const [pid, cat] of [['td', 'TEST_DEPOSITS'], ['hl', 'TEST_LOANS']] as const) {
    await putProduct(db, id, { pid, category: cat, name: pid, descr: null, tailored: false, updated: null, rates: [] }, new Date())
  }
  await putDecisions(db, [{ at: DEC, change: 0.0025, target: 0.046, raw: '+0.25,4.60' }])

  const add = (pid: string, kind: string, type: string, term: string | null, rate: number, from: string, to: string | null, detail: unknown) =>
    db.query(
      `insert into rate (brand_id, pid, kind, rate_type, term, key, rate, detail, from_at, to_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, pid, kind, type, term, `${pid}|${type}|${term}|${from}`, rate, JSON.stringify(detail), from, to],
    )

  const oo = { loanPurpose: 'OWNER_OCCUPIED', repayType: 'PRINCIPAL_AND_INTEREST' }
  await add('td', 'deposit', 'FIXED', 'P1Y', 0.051, '2026-06-01', null, {})
  await add('td', 'deposit', 'FIXED', 'P12M', 0.053, '2026-06-01', null, {})
  await add('td', 'deposit', 'FIXED', 'P2Y', 0.06, '2026-06-01', null, {})
  await add('hl', 'lending', 'VARIABLE', null, 0.058, '2026-06-01', '2026-06-05', oo)
  await add('hl', 'lending', 'VARIABLE', null, 0.0605, '2026-06-05', null, oo)
  await add('hl', 'lending', 'DISCOUNT', null, 0.002, '2026-06-01', null, oo)
  await add('hl', 'lending', 'FIXED', null, 0.004, '2026-06-01', null, oo)
  // The one that moved has to look like a close and a reopen of the same key.
  await db.query(`update rate set key = 'hl|VARIABLE|null|2026-06-01' where brand_id = $1 and pid = 'hl' and rate_type = 'VARIABLE'`, [id])
})

after(async () => {
  if (!db) return
  await db.query('delete from brand where id = $1', [id])
  await db.query('delete from cash_rate where at = $1', [DEC])
  await db.end()
})

const mine = (rows: any[]) => rows.filter((r) => r.brand === 'Read Bank')

test('a deposit ranking puts the highest rate first', opts, async () => {
  const r = mine(await Q.best(q, 'TEST_DEPOSITS', 'deposit', null, null))
  assert.equal(Number(r[0].rate), 0.06)
})

test('a loan ranking puts the lowest rate first', opts, async () => {
  const r = mine(await Q.best(q, 'TEST_LOANS', 'lending', null, null))
  assert.equal(Number(r[0].rate), 0.0605)
})

test('a discount and a sub one percent loading are not rates anyone pays', opts, async () => {
  const r = mine(await Q.best(q, 'TEST_LOANS', 'lending', null, null))
  assert.deepEqual(r.map((x) => x.rate_type), ['VARIABLE'])
})

test('P1Y and P12M are the same twelve months', opts, async () => {
  const r = mine(await Q.best(q, 'TEST_DEPOSITS', 'deposit', 12, null))
  assert.deepEqual(r.map((x) => Number(x.rate)).sort(), [0.051, 0.053])
})

test('an old number is still answerable at its own date', opts, async () => {
  const r = mine(await Q.best(q, 'TEST_LOANS', 'lending', null, '2026-06-03'))
  assert.equal(Number(r[0].rate), 0.058)
})

test('a move reports what the rate was and what it became', opts, async () => {
  const [m] = mine(await Q.moves(q, 36500))
  assert.deepEqual([Number(m.was), Number(m.now)], [0.058, 0.0605])
})

test('passthrough counts the days and the share of the decision', opts, async () => {
  const [p] = mine(await Q.passthrough(q, DEC, 60))
  assert.equal(p.days, 2)
  assert.equal(Number(p.share), 1)
})

test('history keeps the closed interval next to the open one', opts, async () => {
  const h = await Q.history(q, id, 'hl')
  const v = h.filter((r) => r.rate_type === 'VARIABLE')
  assert.equal(v.length, 2)
  assert.equal(v[0].to_at, null)
  assert.notEqual(v[1].to_at, null)
})

test('a product that was never seen has no history', opts, async () => {
  assert.deepEqual(await Q.history(q, id, 'nope'), [])
  assert.deepEqual(await Q.history(q, '', ''), [])
})
