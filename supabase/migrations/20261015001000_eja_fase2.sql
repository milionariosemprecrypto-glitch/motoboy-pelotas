-- É-Já Fase 2: distância de rota, rastreio ao vivo, tokens de push, admin.

-- ===== Admin =====
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;
create policy "admin vê perfis"   on public.profiles for select to authenticated using (public.is_admin());
create policy "admin vê motoboys" on public.motoboys for select to authenticated using (public.is_admin());
create policy "admin vê pedidos"  on public.pedidos  for select to authenticated using (public.is_admin());
create policy "docs: admin vê tudo" on storage.objects for select to authenticated
  using (bucket_id = 'motoboy-docs' and public.is_admin());

create or replace function public.definir_status_motoboy(p_motoboy uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  if p_status not in ('pendente','aprovado','bloqueado') then raise exception 'Status inválido'; end if;
  update motoboys set status = p_status, online = case when p_status = 'aprovado' then online else false end where id = p_motoboy;
end $$;

-- ===== Preço com distância de rota (OSRM) validada pelo servidor =====
insert into public.config values
  ('rota_min_fator', 1.0, 'Rota informada não pode ser menor que a linha reta × isto'),
  ('rota_max_fator', 2.5, 'Rota informada não pode ser maior que a linha reta × isto'),
  ('raio_aviso_km',  5,   'Raio para avisar motoboys de um pedido novo (km)')
on conflict (chave) do nothing;

drop function if exists public.cotar_preco(float8,float8,float8,float8);
drop function if exists public.criar_pedido(text,text,text,float8,float8,float8,float8);

create or replace function public.cotar_preco(p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8,
  p_rota_km numeric default null)
returns table(distancia_km numeric, preco numeric, fonte text)
language plpgsql stable security definer set search_path = public as $$
declare reta numeric; km numeric; f text;
begin
  reta := haversine_km(p_ret_lat,p_ret_lng,p_ent_lat,p_ent_lng);
  if p_rota_km is not null and p_rota_km between reta * cfg('rota_min_fator') and reta * cfg('rota_max_fator') + 0.5 then
    km := round(p_rota_km, 2); f := 'rota';
  else
    km := round(reta * cfg('fator_rota'), 2); f := 'estimativa';   -- rota ausente ou suspeita: usa a estimativa
  end if;
  if km > cfg('km_maximo') then raise exception 'Distância acima do limite de % km', cfg('km_maximo'); end if;
  return query select km, round(greatest(cfg('tarifa_minima'), km * cfg('preco_km')), 2), f;
end $$;

create or replace function public.criar_pedido(p_retirada text, p_entrega text, p_item text,
  p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8, p_rota_km numeric default null)
returns table(pedido_id uuid, valor numeric, km numeric, cod text)
language plpgsql security definer set search_path = public as $$
declare q record; v_id uuid; v_cod text;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('cliente','admin')) then raise exception 'Apenas clientes podem pedir'; end if;
  if exists (select 1 from pedidos where cliente_id = auth.uid() and status in ('procurando','aceito','coletado')) then
    raise exception 'Você já tem um pedido em andamento'; end if;
  select * into q from cotar_preco(p_ret_lat,p_ret_lng,p_ent_lat,p_ent_lng,p_rota_km);
  insert into pedidos (cliente_id, retirada, entrega, item, ret_lat, ret_lng, ent_lat, ent_lng, distancia_km, preco)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item,60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng, q.distancia_km, q.preco)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

-- ===== Rastreio ao vivo =====
-- Tabela só com a posição da corrida ativa (não expõe CPF etc. do motoboy ao cliente).
create table public.posicoes (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  motoboy_id uuid not null references public.motoboys(id),
  lat double precision not null, lng double precision not null,
  em timestamptz not null default now()
);
alter table public.posicoes enable row level security;
create policy "posicoes: cliente do pedido" on public.posicoes for select to authenticated
  using (exists (select 1 from pedidos p where p.id = pedido_id and p.cliente_id = auth.uid() and p.status in ('aceito','coletado')));
create policy "posicoes: motoboy" on public.posicoes for select to authenticated using (motoboy_id = auth.uid());
create policy "posicoes: admin" on public.posicoes for select to authenticated using (public.is_admin());
revoke all on public.posicoes from anon, authenticated;
grant select on public.posicoes to authenticated;
alter publication supabase_realtime add table public.posicoes;

create or replace function public.atualizar_local(p_lat float8, p_lng float8, p_online boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_pedido uuid;
begin
  update motoboys set lat = p_lat, lng = p_lng, online = p_online, local_em = now()
   where id = auth.uid() and status = 'aprovado';
  if not found then return; end if;
  select id into v_pedido from pedidos where motoboy_id = auth.uid() and status in ('aceito','coletado') limit 1;
  if v_pedido is not null then
    insert into posicoes (pedido_id, motoboy_id, lat, lng) values (v_pedido, auth.uid(), p_lat, p_lng)
    on conflict (pedido_id) do update set lat = excluded.lat, lng = excluded.lng, em = now();
  end if;
end $$;

-- ===== Tokens de push (FCM) =====
create table public.device_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  app text not null check (app in ('cliente','motoboy')),
  atualizado_em timestamptz not null default now()
);
alter table public.device_tokens enable row level security;
create policy "tokens: ver os próprios" on public.device_tokens for select to authenticated using (user_id = auth.uid());
revoke all on public.device_tokens from anon, authenticated;
grant select on public.device_tokens to authenticated;

create or replace function public.registrar_token(p_token text, p_app text) returns void
language sql security definer set search_path = public as $$
  insert into device_tokens (token, user_id, app) values (p_token, auth.uid(), p_app)
  on conflict (token) do update set user_id = auth.uid(), app = excluded.app, atualizado_em = now()
$$;
create or replace function public.remover_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from device_tokens where token = p_token and user_id = auth.uid()
$$;

-- ===== Disparo de push: trigger -> pg_net -> Edge Function "notificar" =====
create extension if not exists pg_net with schema extensions;
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create table if not exists privado.segredos (nome text primary key, valor text not null);
insert into privado.segredos values ('notificar_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (nome) do nothing;

create or replace function privado.avisar_pedido() returns trigger
language plpgsql security definer set search_path = public, privado as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform net.http_post(
      url := 'https://waalgvcywtfnrrpkrhti.supabase.co/functions/v1/notificar',
      headers := jsonb_build_object('Content-Type','application/json',
                 'x-eja-secret', (select valor from privado.segredos where nome = 'notificar_secret')),
      body := jsonb_build_object('pedido_id', new.id, 'status', new.status, 'evento', tg_op));
  end if;
  return new;
exception when others then return new;  -- nunca impedir o pedido por falha no push
end $$;
create trigger pedidos_push after insert or update of status on public.pedidos
  for each row execute function privado.avisar_pedido();

-- ===== Admin: listas =====
create or replace function public.admin_motoboys()
returns table(id uuid, nome text, telefone text, email text, cpf text, cnh text, placa text, modelo text,
  foto_path text, doc_path text, status text, enviado_em timestamptz, online boolean, local_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select m.id, p.nome, p.telefone, u.email::text, m.cpf, m.cnh, m.placa, m.modelo, m.foto_path, m.doc_path,
    m.status, m.enviado_em, m.online, m.local_em
    from motoboys m join profiles p on p.id = m.id join auth.users u on u.id = m.id
    order by (m.status = 'pendente' and m.enviado_em is not null) desc, m.enviado_em desc nulls last;
end $$;

create or replace function public.admin_pedidos()
returns table(id uuid, criado_em timestamptz, cliente text, motoboy text, retirada text, entrega text,
  distancia_km numeric, preco numeric, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select p.id, p.criado_em, c.nome, mp.nome, p.retirada, p.entrega, p.distancia_km, p.preco, p.status
    from pedidos p join profiles c on c.id = p.cliente_id left join profiles mp on mp.id = p.motoboy_id
    order by p.criado_em desc limit 200;
end $$;

-- Permissões: funções públicas só para logados
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.novo_usuario() from authenticated;
