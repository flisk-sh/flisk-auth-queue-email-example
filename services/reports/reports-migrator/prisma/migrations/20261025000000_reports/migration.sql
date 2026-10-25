-- Report requests and their progress. `seq` orders them; `id` (r_<seq>) is what the API and the worker share.
create table if not exists reports (
  seq bigserial primary key,
  id text not null unique generated always as ('r_' || seq::text) stored,
  user_id text not null,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'queued' check (status in ('queued', 'processing', 'retrying', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  crash_first_attempt boolean not null default false,
  row_count integer,
  sent_to text,
  error text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_user_id_seq_idx on reports (user_id, seq desc);
