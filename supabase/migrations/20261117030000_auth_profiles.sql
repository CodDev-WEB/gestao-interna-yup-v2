-- Perfis de acesso (Supabase Auth), como no Gestão à Vista.
-- O login é feito no Supabase Auth (e-mail e senha); só perfis ativos com papel 'admin' usam as rotas /api/*.
-- Cadastre o usuário em Authentication > Users e depois:
--   insert into public.profiles (id, full_name, role, active)
--   select id, 'Seu nome', 'admin', true from auth.users where email = 'seu@email.com'
--   on conflict (id) do update set role = excluded.role, active = true;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute $q$create table if not exists public.profiles (
      id         uuid primary key references auth.users (id) on delete cascade,
      full_name  text,
      role       text not null default 'viewer' check (role in ('admin', 'viewer')),
      active     boolean not null default true,
      created_at timestamptz not null default now()
    )$q$;
  else
    -- Ambiente de teste sem o schema auth.
    execute $q$create table if not exists public.profiles (
      id         uuid primary key,
      full_name  text,
      role       text not null default 'viewer' check (role in ('admin', 'viewer')),
      active     boolean not null default true,
      created_at timestamptz not null default now()
    )$q$;
  end if;
end $$;

alter table public.profiles enable row level security;

-- Cada usuário logado lê só o próprio perfil; ninguém altera pelo navegador.
drop policy if exists profiles_select_own on public.profiles;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute $q$create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid())$q$;
  end if;
end $$;
