-- Run this in Supabase Dashboard -> SQL Editor -> New query

-- profiles extends Supabase's built-in auth.users with app-specific fields.
-- (Supabase Auth already handles password hashing/verification/sessions -
-- you don't write that code yourself with this stack.)
create table if not exists public.profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    username    varchar(50) not null unique,
    role        varchar(20) not null default 'viewer'
                    check (role in ('admin','hr','payroll','viewer')),
    is_active   smallint not null default 1,
    created_at  timestamp not null default now(),
    updated_at  timestamp not null default now()
);

create table if not exists public.audit_logs (
    id          bigserial primary key,
    user_id     uuid references auth.users(id) on delete set null,
    action      varchar(100) not null,
    details     text,
    created_at  timestamp not null default now()
);

create index if not exists idx_audit_user on public.audit_logs(user_id);
create index if not exists idx_audit_action on public.audit_logs(action);
create index if not exists idx_audit_created on public.audit_logs(created_at);

alter table public.profiles enable row level security;
alter table public.audit_logs enable row level security;

-- A signed-in user can read their own profile row
create policy "Users can view own profile"
    on public.profiles for select
    using (auth.uid() = id);

-- A signed-in user can update their own profile row
-- (Stage 1 keeps this simple; a later stage restricts role/is_active
-- changes to admins only, since a user shouldn't be able to promote
-- themselves.)
create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id);

-- A signed-in user can insert an audit log row for THEMSELVES only -
-- this prevents anyone from forging a log entry under another user's id.
create policy "Users can insert own audit logs"
    on public.audit_logs for insert
    with check (auth.uid() = user_id);

-- A signed-in user can read their own audit log rows
-- (admin-wide read access comes in a later stage)
create policy "Users can view own audit logs"
    on public.audit_logs for select
    using (auth.uid() = user_id);

-- Auto-create a profile row whenever a new user is added in
-- Authentication -> Users. Defaults role to 'viewer' - promote your
-- first admin manually afterward (see instructions).
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, username, role, is_active)
    values (new.id, split_part(new.email, '@', 1), 'viewer', 1)
    on conflict (id) do nothing;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
