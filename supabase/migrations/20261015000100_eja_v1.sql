-- É-Já v1: schema seguro (auth + RLS + RPCs com auth.uid() + preço no servidor)
-- O protótipo antigo é preservado: public.pedidos -> public.pedidos_v0 (e public.orders fica intacta).

-- ===== 0. Guardar o protótipo antigo =====
drop function if exists public.criar_pedido(text,text,text,integer);
drop function if exists public.status_pedido(uuid);
drop function if exists public.cancelar_pedido(uuid);
drop function if exists public.pedidos_abertos();
drop function if exists public.aceitar_pedido(uuid,text);
drop function if exists public.avancar_pedido(uuid,text,text);
drop function if exists public.minha_corrida(text);
drop function if exists public.ganhos(text);
alter table if exists public.pedidos rename to pedidos_v0;
revoke all on public.pedidos_v0 from anon, authenticated;

-- ===== 1. Configuração de preço =====
create table public.config (
  chave text primary key,
  valor numeric not null,
  descricao text
);
insert into public.config values
  ('tarifa_minima', 8.00, 'Valor mínimo da corrida (R$)'),
  ('preco_km',      2.00, 'Valor por km (R$)'),
  ('fator_rota',    1.30, 'Multiplica a distância em linha reta para estimar a rota real'),
  ('km_maximo',     30,   'Distância máxima aceita (km)');
alter table public.config enable row level security;
create policy "config: leitura para logados" on public.config for select to authenticated using (true);
revoke all on public.config from anon, authenticated;
grant select on public.config to authenticated;

-- ===== 2. Perfis =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'cliente' check (role in ('cliente','motoboy','admin')),
  nome text not null default '' check (char_length(nome) <= 80),
  telefone text check (char_length(telefone) <= 20),
  criado_em timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: ver o próprio" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles: editar o próprio" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nome, telefone) on public.profiles to authenticated;  -- role NÃO pode ser alterado pelo usuário

-- Cria o perfil automaticamente no cadastro. Só aceita 'cliente' ou 'motoboy' (nunca admin).
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(new.raw_user_meta_data->>'role', 'cliente');
begin
  if v_role not in ('cliente','motoboy') then v_role := 'cliente'; end if;
  insert into public.profiles (id, role, nome, telefone)
  values (new.id, v_role, left(coalesce(new.raw_user_meta_data->>'nome',''),80), left(new.raw_user_meta_data->>'telefone',20));
  if v_role = 'motoboy' then insert into public.motoboys (id) values (new.id); end if;
  return new;
end $$;

-- ===== 3. Motoboys =====
create table public.motoboys (
  id uuid primary key references public.profiles(id) on delete cascade,
  cpf text check (cpf ~ '^[0-9]{11}$'),
  cnh text check (char_length(cnh) <= 20),
  placa text check (char_length(placa) <= 10),
  modelo text check (char_length(modelo) <= 60),
  foto_path text,        -- caminho no bucket privado motoboy-docs
  doc_path text,         -- foto da CNH / documento da moto
  status text not null default 'pendente' check (status in ('pendente','aprovado','bloqueado')),
  enviado_em timestamptz,
  online boolean not null default false,
  lat double precision, lng double precision, local_em timestamptz
);
alter table public.motoboys enable row level security;
create policy "motoboys: ver o próprio" on public.motoboys for select to authenticated using (id = auth.uid());
revoke all on public.motoboys from anon, authenticated;
grant select on public.motoboys to authenticated;  -- escrita só via RPC

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.novo_usuario();

-- ===== 4. Pedidos =====
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  cliente_id uuid not null references public.profiles(id),
  motoboy_id uuid references public.motoboys(id),
  retirada text not null check (char_length(retirada) between 3 and 200),
  entrega  text not null check (char_length(entrega) between 3 and 200),
  ret_lat double precision not null, ret_lng double precision not null,
  ent_lat double precision not null, ent_lng double precision not null,
  item text not null check (char_length(item) <= 60),
  distancia_km numeric(6,2) not null,
  preco numeric(10,2) not null,
  status text not null default 'procurando' check (status in ('procurando','aceito','coletado','entregue','cancelado')),
  aceito_em timestamptz, coletado_em timestamptz, entregue_em timestamptz, cancelado_em timestamptz
);
create index on public.pedidos (status, criado_em);
create index on public.pedidos (cliente_id);
create index on public.pedidos (motoboy_id);
alter table public.pedidos enable row level security;
create policy "pedidos: cliente vê os seus" on public.pedidos for select to authenticated using (cliente_id = auth.uid());
create policy "pedidos: motoboy vê os que aceitou" on public.pedidos for select to authenticated using (motoboy_id = auth.uid());
revoke all on public.pedidos from anon, authenticated;
grant select on public.pedidos to authenticated;  -- escrita só via RPC

-- Código de entrega separado: só o cliente vê (o motoboy precisa pedir ao destinatário)
create table public.pedido_codigos (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  codigo text not null default lpad((floor(random()*10000))::int::text, 4, '0')
);
alter table public.pedido_codigos enable row level security;
create policy "codigos: só o cliente" on public.pedido_codigos for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id and p.cliente_id = auth.uid()));
revoke all on public.pedido_codigos from anon, authenticated;
grant select on public.pedido_codigos to authenticated;

-- Realtime (respeita RLS: cada um recebe só os seus pedidos)
alter publication supabase_realtime add table public.pedidos;

-- ===== 5. Funções auxiliares =====
create or replace function public.cfg(p text) returns numeric
language sql stable security definer set search_path = public as $$ select valor from public.config where chave = p $$;

create or replace function public.haversine_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371 * asin(sqrt(power(sin(radians(lat2-lat1)/2),2) + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2)))
$$;

create or replace function public.motoboy_aprovado() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.motoboys m join public.profiles p on p.id = m.id
                 where m.id = auth.uid() and p.role = 'motoboy' and m.status = 'aprovado')
$$;

-- ===== 6. RPCs do cliente =====
create or replace function public.cotar_preco(p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8)
returns table(distancia_km numeric, preco numeric)
language plpgsql stable security definer set search_path = public as $$
declare km numeric;
begin
  km := round((haversine_km(p_ret_lat,p_ret_lng,p_ent_lat,p_ent_lng) * cfg('fator_rota'))::numeric, 2);
  if km > cfg('km_maximo') then raise exception 'Distância acima do limite de % km', cfg('km_maximo'); end if;
  return query select km, round(greatest(cfg('tarifa_minima'), km * cfg('preco_km')), 2);
end $$;

create or replace function public.criar_pedido(p_retirada text, p_entrega text, p_item text,
  p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8)
returns table(pedido_id uuid, valor numeric, km numeric, cod text)
language plpgsql security definer set search_path = public as $$
declare q record; v_id uuid; v_cod text;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('cliente','admin')) then raise exception 'Apenas clientes podem pedir'; end if;
  if exists (select 1 from pedidos where cliente_id = auth.uid() and status in ('procurando','aceito','coletado')) then
    raise exception 'Você já tem um pedido em andamento'; end if;
  select * into q from cotar_preco(p_ret_lat,p_ret_lng,p_ent_lat,p_ent_lng);
  insert into pedidos (cliente_id, retirada, entrega, item, ret_lat, ret_lng, ent_lat, ent_lng, distancia_km, preco)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item,60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng, q.distancia_km, q.preco)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

create or replace function public.status_pedido(p_id uuid)
returns table(status text, motoboy_nome text, placa text, modelo text, lat float8, lng float8)
language sql stable security definer set search_path = public as $$
  select p.status, pr.nome, m.placa, m.modelo, m.lat, m.lng
  from pedidos p left join motoboys m on m.id = p.motoboy_id left join profiles pr on pr.id = m.id
  where p.id = p_id and p.cliente_id = auth.uid()
$$;

create or replace function public.meu_pedido_ativo()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text, codigo text)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, c.codigo
  from pedidos p join pedido_codigos c on c.pedido_id = p.id
  where p.cliente_id = auth.uid() and p.status in ('procurando','aceito','coletado')
  order by p.criado_em desc limit 1
$$;

create or replace function public.cancelar_pedido(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update pedidos set status = 'cancelado', cancelado_em = now()
   where id = p_id and cliente_id = auth.uid() and status in ('procurando','aceito');
  return found;
end $$;

-- ===== 7. RPCs do motoboy =====
create or replace function public.enviar_cadastro_motoboy(p_nome text, p_telefone text, p_cpf text, p_cnh text,
  p_placa text, p_modelo text, p_foto_path text, p_doc_path text) returns text
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from motoboys where id = auth.uid();
  if v_status is null then raise exception 'Conta não é de motoboy'; end if;
  if v_status = 'bloqueado' then raise exception 'Cadastro bloqueado'; end if;
  if p_foto_path not like auth.uid()::text || '/%' or p_doc_path not like auth.uid()::text || '/%' then
    raise exception 'Arquivos inválidos'; end if;
  update profiles set nome = left(trim(p_nome),80), telefone = left(trim(p_telefone),20) where id = auth.uid();
  update motoboys set cpf = regexp_replace(p_cpf,'\D','','g'), cnh = trim(p_cnh), placa = upper(trim(p_placa)),
         modelo = trim(p_modelo), foto_path = p_foto_path, doc_path = p_doc_path, enviado_em = now()
   where id = auth.uid();       -- status continua como está (pendente até o admin aprovar)
  return v_status;
end $$;

create or replace function public.atualizar_local(p_lat float8, p_lng float8, p_online boolean) returns void
language sql security definer set search_path = public as $$
  update motoboys set lat = p_lat, lng = p_lng, online = p_online, local_em = now()
   where id = auth.uid() and status = 'aprovado'
$$;

create or replace function public.pedidos_abertos()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, distancia_km numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not motoboy_aprovado() then raise exception 'Motoboy não aprovado'; end if;
  return query select p.id, p.retirada, p.entrega, p.item, p.preco, p.distancia_km
    from pedidos p where p.status = 'procurando' order by p.criado_em limit 20;
end $$;

create or replace function public.aceitar_pedido(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not motoboy_aprovado() then raise exception 'Motoboy não aprovado'; end if;
  if exists (select 1 from pedidos where motoboy_id = auth.uid() and status in ('aceito','coletado')) then
    raise exception 'Termine sua corrida atual primeiro'; end if;
  update pedidos set status = 'aceito', motoboy_id = auth.uid(), aceito_em = now()
   where id = p_id and status = 'procurando';
  return found;
end $$;

create or replace function public.avancar_pedido(p_id uuid, p_codigo text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v pedidos; v_cod text;
begin
  if not motoboy_aprovado() then raise exception 'Motoboy não aprovado'; end if;
  select * into v from pedidos where id = p_id and motoboy_id = auth.uid() for update;
  if not found then return 'nao_encontrado'; end if;
  if v.status = 'aceito' then
    update pedidos set status = 'coletado', coletado_em = now() where id = p_id; return 'coletado';
  elsif v.status = 'coletado' then
    select codigo into v_cod from pedido_codigos where pedido_id = p_id;
    if coalesce(trim(p_codigo),'') <> v_cod then return 'codigo_errado'; end if;
    update pedidos set status = 'entregue', entregue_em = now() where id = p_id; return 'entregue';
  end if;
  return v.status;
end $$;

create or replace function public.minha_corrida()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text,
              ret_lat float8, ret_lng float8, ent_lat float8, ent_lng float8)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, p.ret_lat, p.ret_lng, p.ent_lat, p.ent_lng
  from pedidos p where p.motoboy_id = auth.uid() and p.status in ('aceito','coletado')
  order by p.criado_em desc limit 1
$$;

create or replace function public.ganhos()
returns table(id uuid, retirada text, entrega text, preco numeric, entregue_em timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.preco, p.entregue_em from pedidos p
  where p.motoboy_id = auth.uid() and p.status = 'entregue' order by p.entregue_em desc limit 50
$$;

-- ===== 8. Admin =====
create or replace function public.definir_status_motoboy(p_motoboy uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then raise exception 'Apenas admin'; end if;
  update motoboys set status = p_status where id = p_motoboy;
end $$;

-- ===== 9. Permissões das funções: nada para anon =====
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.novo_usuario() from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ===== 10. Storage privado para documentos =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('motoboy-docs', 'motoboy-docs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy "docs: motoboy envia na própria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'motoboy-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs: motoboy vê a própria pasta" on storage.objects for select to authenticated
  using (bucket_id = 'motoboy-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs: motoboy substitui na própria pasta" on storage.objects for update to authenticated
  using (bucket_id = 'motoboy-docs' and (storage.foldername(name))[1] = auth.uid()::text);
