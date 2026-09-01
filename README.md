# rate-ledger

Every bank in Australia is required to publish its advertised products and rates
through an unauthenticated Consumer Data Right endpoint. Nobody keeps the history.
The numbers change and the old ones are gone.

This walks all 250 registered banking and non-bank-lending brands once a day,
stores each rate as an interval rather than a daily row, and can answer what any
product's rate was on any past date, and which lenders moved after a cash rate
decision and how many days they took.

## What it found on the first pass

    213 / 249 brands answered
    4,120 products
    21,621 open rate intervals   (6,104 deposit, 15,517 lending)
    6 minutes, 52 failures

A second pass seven minutes later rewrote 12 of those 21,621, and all twelve were
MoveBank, which served a different set of home loan rates the second time.

## Running it daily

A scheduled workflow walks the register at 06:00 AEST, writes the day's summary
into `data/`, and commits it. The commit is the point: the schedule is what
proves the thing runs unattended, and GitHub switches a schedule off after 60
quiet days, so the job has to leave a mark.

    data/latest.json      the most recent pass
    data/2026-09-01.json  and every one before it

## Running it locally

    docker compose up -d
    export DATABASE_URL=postgres://ledger:ledger@localhost:5433/ledger
    npm ci && npm run db
    npm run ingest
    npm run serve

    curl 'localhost:8080/best?category=TERM_DEPOSITS&term=P1Y'
    curl 'localhost:8080/moves?days=7'
    curl 'localhost:8080/counts'
    curl 'localhost:8080/health'

## Notes on the source

The register lists 334 brands across banking, non-bank lending and energy. The
`industries` field is the filter and `productBaseUri` is the endpoint; the
`publicBaseUri` next to it serves something else and answers 406.

Version negotiation is per endpoint, not per holder. Get Products currently
settles at v5 and Get Product Detail at v7, and asking for the wrong one returns
406 with the version the holder does support named in the `x-v` header of the
error. Sending `x-v: 10` with `x-min-v: 1` gets 206 of 214 holders in one call;
the rest are picked up by reading that header and asking again.

Rates are not uniquely identified by type and term. ING lists three owner-occupied
principal-and-interest variable rates at the same price, separated only by their
LVR band, so the tier set has to be part of a rate's identity. The tiers arrive in
different order from different replicas, which is why the key is built from a
canonical form: arrays sorted by their own serialisation, object keys sorted.
Without that, a quiet day rewrites hundreds of intervals that never moved.

Some holders disagree with themselves. Three consecutive reads of one ING product
gave two different tier sets, and MoveBank served two different sets of home loan
rates seven minutes apart. Nothing here fixes that; the ledger records what was
served and when, which is the only honest thing it can do.

## Layout

    src/cdr.ts     register, product list, product detail, rate identity
    src/db.ts      schema access and the interval open/close
    src/ingest.ts  one lane per holder, failures recorded not thrown
    src/queries.ts the read side's SQL, written once
    src/api.ts     local server over it
    src/summary.ts the daily file that lands in data/
    schema.sql

## Licence

MIT. The data is published under CC BY 4.0 by each data holder under the
Consumer Data Right. This is not affiliated with any bank or with the ACCC.
