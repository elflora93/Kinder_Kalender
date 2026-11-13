-- Kinder-Kalender: einmal im Supabase SQL Editor ausführen

-- Eine Tabelle für alle Kalender-Daten (Personen, Woche, besondere Tage, Einträge, Änderungen)
create table if not exists public.daten (
  schluessel text primary key,
  wert jsonb not null,
  geaendert timestamptz not null default now()
);

-- Nur angemeldete Familien-Geräte dürfen lesen und schreiben
alter table public.daten enable row level security;

drop policy if exists "Familie liest" on public.daten;
drop policy if exists "Familie legt an" on public.daten;
drop policy if exists "Familie ändert" on public.daten;
drop policy if exists "Familie löscht" on public.daten;

create policy "Familie liest"   on public.daten for select to authenticated using (true);
create policy "Familie legt an" on public.daten for insert to authenticated with check (true);
create policy "Familie ändert"  on public.daten for update to authenticated using (true) with check (true);
create policy "Familie löscht"  on public.daten for delete to authenticated using (true);

-- Änderungen sofort an alle Geräte schicken (z. B. an den Wand-Monitor)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daten'
  ) then
    alter publication supabase_realtime add table public.daten;
  end if;
end $$;
