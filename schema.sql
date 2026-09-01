create table if not exists brand (
  id          uuid primary key,
  name        text not null,
  abn         text,
  industries  text[] not null,
  base_uri    text not null,
  logo_uri    text,
  last_ok     timestamptz,
  last_err    text
);

create table if not exists product (
  brand_id    uuid not null references brand on delete cascade,
  pid         text not null,
  category    text not null,
  name        text not null,
  descr       text,
  tailored    boolean not null default false,
  updated     timestamptz,
  first_seen  timestamptz not null,
  last_seen   timestamptz not null,
  gone_at     timestamptz,
  primary key (brand_id, pid)
);

create index if not exists product_category on product (category) where gone_at is null;

-- One row per (rate, period it held). Writing a row a day would be 1.5M rows a year
-- of mostly identical numbers; the interval only closes when the number moves.
create table if not exists rate (
  id        bigserial primary key,
  brand_id  uuid not null,
  pid       text not null,
  kind      text not null,
  rate_type text not null,
  term      text,
  key       text not null,
  rate      numeric(12,8) not null,
  detail    jsonb,
  from_at   timestamptz not null,
  to_at     timestamptz,
  foreign key (brand_id, pid) references product on delete cascade
);

create unique index if not exists rate_open on rate (brand_id, pid, key) where to_at is null;
create index if not exists rate_span on rate (brand_id, pid, from_at desc);
create index if not exists rate_kind on rate (kind, rate_type, term) where to_at is null;
-- /moves walks back from an open interval to the one it replaced, matched on close time.
create index if not exists rate_prev on rate (brand_id, pid, key, to_at);

create table if not exists run (
  id            bigserial primary key,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  brands_total  int not null default 0,
  brands_ok     int not null default 0,
  products_seen int not null default 0,
  opened        int not null default 0,
  closed        int not null default 0,
  failures      jsonb not null default '[]'
);

-- additionalValue carries an ISO 8601 term for a fixed rate and a sentence of
-- prose for a discount, so only the durations are a term.
create or replace function tenor(t text) returns text language sql immutable as $$
  select case when t ~ '^P[0-9]' then t end
$$;

create or replace function term_months(t text) returns int language sql immutable as $$
  select case when t ~ '^P[0-9]' then
    coalesce((substring(t from 'P(\d+)Y'))::int, 0) * 12
    + coalesce((substring(t from '(\d+)M'))::int, 0)
    + coalesce((substring(t from '(\d+)D'))::int, 0) / 30
  end
$$;
