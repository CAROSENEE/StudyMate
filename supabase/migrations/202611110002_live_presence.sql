-- Short-lived app presence for admin operational visibility.
-- Store account, coarse app section and heartbeat only; never message content or device/IP data.
create table if not exists public.user_presence (
  user_id bigint not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  screen text not null default 'home' check (screen in ('home','routine','planner','progress','profile','friends','messages','chat','materials','assignments','quizzes','notifications','manager_home','manager_materials','manager_assignments','manager_quizzes','manager_progress','admin')),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
create index if not exists user_presence_last_seen on public.user_presence(last_seen_at desc);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;
