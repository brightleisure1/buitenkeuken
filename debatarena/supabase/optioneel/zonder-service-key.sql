-- Alleen nodig als je de app NIET met de service role key draait,
-- maar met de gewone (anon/publishable) sleutel. Draai dit ná de migraties.
--
-- Vervang VERVANG-DIT-GEHEIM door een lang willekeurig geheim en zet hetzelfde
-- geheim in de omgevingsvariabele SUPABASE_APP_SECRET, plus SUPABASE_ANON_KEY.
-- De database laat dan alleen verzoeken toe die dat geheim meesturen.
-- Met de service role key is dit bestand overbodig.

create or replace function public.debatarena_ok() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-debatarena-secret', '')
         = 'VERVANG-DIT-GEHEIM';
$$;

do $$
declare t text;
begin
  foreach t in array array['settings','templates','runs','messages','attachments','usage_events'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists debatarena_app on public.%I', t);
      execute format('create policy debatarena_app on public.%I for all to anon using (public.debatarena_ok()) with check (public.debatarena_ok())', t);
      execute format('grant select, insert, update, delete on public.%I to anon', t);
    end if;
  end loop;
end $$;

grant execute on function public.merge_prep(uuid, text, jsonb) to anon;
grant execute on function public.add_cost(uuid, numeric) to anon;
grant execute on function public.add_audio(uuid, jsonb) to anon;

-- Opslag: alleen de drie mappen van de Debatarena, en alleen met het geheim.
drop policy if exists debatarena_storage on storage.objects;
create policy debatarena_storage on storage.objects for all to anon
  using (bucket_id in ('portraits', 'audio', 'attachments') and public.debatarena_ok())
  with check (bucket_id in ('portraits', 'audio', 'attachments') and public.debatarena_ok());
