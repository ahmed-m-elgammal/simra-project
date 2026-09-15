create table books (
  id text primary key,
  title text not null,
  author text not null default '',
  status text not null default 'draft' check (status in ('draft','published')),
  bundle_version int not null default 0,
  bundle_url text not null default '',
  bundle_sha text not null default '',
  updated_at timestamptz not null default now()
);
create table book_configs (
  book_id text primary key references books(id) on delete cascade,
  state_variables jsonb not null default '[]',
  bands jsonb not null default '[]',
  bands_compiled jsonb not null default '[]'
);
create table personas (
  id text primary key,
  book_id text not null references books(id) on delete cascade,
  status text not null default 'draft',
  starting_state jsonb not null default '{}',
  gating_base jsonb not null default '{}'
);
create table chapters (
  id text primary key,
  book_id text not null references books(id) on delete cascade,
  status text not null default 'draft',
  "order" int not null,
  title text not null default '',
  content_ref text not null default ''
);
create table decisions (
  id text primary key,
  chapter_id text not null references chapters(id) on delete cascade,
  book_id text not null,
  "order" int not null,
  prompt text not null default ''
);
create table options (
  id text primary key,
  decision_id text not null references decisions(id) on delete cascade,
  chapter_id text not null,
  book_id text not null,
  label text not null default '',
  intent text not null default '',
  next text not null default 'chapter_end',
  requires jsonb,
  lock_reason text not null default '',
  persona_effects jsonb not null default '[]'
);
create table entitlements (
  app_user_id text not null,
  book_id text not null,
  source text not null default 'revenuecat',
  created_at timestamptz not null default now(),
  primary key (app_user_id, book_id)
);
create table free_claims (
  app_user_id text not null,
  book_id text not null,
  created_at timestamptz not null default now(),
  primary key (app_user_id, book_id)
);
create table devices (
  token text primary key,
  app_user_id text not null,
  platform text not null check (platform in ('ios','android')),
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
create index devices_user_idx on devices (app_user_id);
create table progress (
  app_user_id text not null,
  book_id text not null,
  furthest_chapter int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (app_user_id, book_id)
);
create index progress_book_idx on progress (book_id, furthest_chapter);
create table requests (
  id bigserial primary key,
  app_user_id text not null,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now()
);
create index requests_user_idx on requests (app_user_id, created_at);
create table revenue_events (
  event_id text primary key,
  app_user_id text not null,
  book_id text not null default '',
  type text not null,
  created_at timestamptz not null default now()
);
create table backups (
  app_user_id text primary key,
  blob jsonb not null,
  blob_version int not null,
  updated_at timestamptz not null default now()
);
create table accounts (
  app_user_id text primary key,
  email text,
  created_at timestamptz not null default now()
);
create table flags (
  key text primary key,
  value jsonb not null
);
insert into flags (key, value) values ('payments_enabled', 'false');

alter table books enable row level security;
alter table book_configs enable row level security;
alter table personas enable row level security;
alter table chapters enable row level security;
alter table decisions enable row level security;
alter table options enable row level security;
alter table entitlements enable row level security;
alter table free_claims enable row level security;
alter table devices enable row level security;
alter table progress enable row level security;
alter table requests enable row level security;
alter table revenue_events enable row level security;
alter table backups enable row level security;
alter table accounts enable row level security;
-- No permissive policies: anon gets nothing. Edge Functions use the
-- service_role key and bypass RLS. Direct client reads are never added.
