// The read side, written once. Both the local server and the worker hand in a
// query function; neither owns any SQL.
export type Q = (sql: string, args: unknown[]) => Promise<any[]>

export const health = (q: Q) =>
  q(`select id, started_at, finished_at, brands_ok, brands_total, products_seen,
            opened, closed, jsonb_array_length(failures) as failures
       from run order by id desc limit 1`, [])

// Best means the highest rate on a deposit and the lowest on a loan. Discounts
// and penalties are increments off a reference rate rather than a rate anyone
// pays, so they cannot be ranked against one.
export const best = (q: Q, cat: string, kind: string, months: number | null, at: string | null) =>
  q(`select b.name as brand, p.name as product, r.rate_type, tenor(r.term) as term, r.rate,
            r.from_at, r.detail->>'loanPurpose' as purpose, r.detail->>'repayType' as repay,
            r.detail->>'info' as info
       from rate r
       join product p on (p.brand_id, p.pid) = (r.brand_id, r.pid)
       join brand b on b.id = r.brand_id
      where p.category = $1 and r.kind = $2 and r.rate > 0
        and r.rate_type not in ('DISCOUNT', 'BUNDLE_DISCOUNT', 'PENALTY')
        -- Some holders publish a loading as a FIXED rate and nothing in the
        -- payload separates it from a rate you can borrow at. Under one percent,
        -- on a loan, it is not one.
        and (r.kind = 'deposit' or r.rate >= 0.01)
        and ($3::int is null or term_months(r.term) = $3)
        and ($4::timestamptz is null
             or (r.from_at <= $4 and (r.to_at is null or r.to_at > $4)))
        and ($4::timestamptz is not null or r.to_at is null)
      order by (case when $2 = 'lending' then -r.rate else r.rate end) desc
      limit 25`, [cat, kind, months, at])

export const moves = (q: Q, days: number, limit = 200) =>
  q(`select b.name as brand, p.name as product, p.category, r.kind, r.rate_type,
            tenor(r.term) as term, prev.rate as was, r.rate as now, r.from_at as moved_at
       from rate r
       join product p on (p.brand_id, p.pid) = (r.brand_id, r.pid)
       join brand b on b.id = r.brand_id
       join lateral (
         select rate from rate o
          where o.brand_id = r.brand_id and o.pid = r.pid and o.key = r.key
            and o.to_at = r.from_at
          order by o.to_at desc limit 1) prev on true
      where r.from_at > now() - ($1 || ' days')::interval
      order by abs(r.rate - prev.rate) desc, r.from_at desc limit $2`, [days, limit])

export const brands = (q: Q) =>
  q(`select b.name, b.industries, b.last_ok, b.last_err,
            count(p.pid) filter (where p.gone_at is null) as products
       from brand b left join product p on p.brand_id = b.id
      group by b.id order by products desc, b.name`, [])

export const counts = (q: Q) =>
  q(`select (select count(*)::int from brand) brands,
            (select count(*)::int from product where gone_at is null) products,
            (select count(*)::int from rate where to_at is null) rates_open,
            (select count(*)::int from rate where to_at is null and kind = 'deposit') deposit,
            (select count(*)::int from rate where to_at is null and kind = 'lending') lending`, [])
