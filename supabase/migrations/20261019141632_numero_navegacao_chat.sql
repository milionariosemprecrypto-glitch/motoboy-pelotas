-- Número/complemento do endereço, chat da corrida e limpeza dessas mensagens.
-- NÃO aplicar em produção por este repositório: rode este arquivo no SQL Editor
-- (ou `supabase db push`) só quando for publicar o app. Pode ser executado de novo.

-- ===== 1. Número e complemento (pedidos antigos ficam com NULL) =====
alter table public.pedidos
  add column if not exists ret_numero text,
  add column if not exists ret_complemento text,
  add column if not exists ent_numero text,
  add column if not exists ent_complemento text;

alter table public.pedidos drop constraint if exists pedidos_ret_numero_check;
alter table public.pedidos add constraint pedidos_ret_numero_check
  check (ret_numero is null or ret_numero = 'S/N' or ret_numero ~ '^[0-9A-Za-z][0-9A-Za-z./-]{0,9}$');
alter table public.pedidos drop constraint if exists pedidos_ent_numero_check;
alter table public.pedidos add constraint pedidos_ent_numero_check
  check (ent_numero is null or ent_numero = 'S/N' or ent_numero ~ '^[0-9A-Za-z][0-9A-Za-z./-]{0,9}$');
alter table public.pedidos drop constraint if exists pedidos_ret_complemento_check;
alter table public.pedidos add constraint pedidos_ret_complemento_check
  check (ret_complemento is null or char_length(ret_complemento) <= 80);
alter table public.pedidos drop constraint if exists pedidos_ent_complemento_check;
alter table public.pedidos add constraint pedidos_ent_complemento_check
  check (ent_complemento is null or char_length(ent_complemento) <= 80);

-- Usadas só por criar_pedido (security definer). Sem EXECUTE para a API.
create or replace function public.normalizar_numero(p text) returns text
language plpgsql immutable as $$
declare t text := trim(coalesce(p, ''));
begin
  if t = '' then return null; end if;
  if upper(t) in ('S/N', 'SN', 'S.N', 'S.N.') then return 'S/N'; end if;
  if t !~ '^[0-9A-Za-z][0-9A-Za-z./-]{0,9}$' then
    raise exception 'Número inválido. Use o número da casa ou S/N.';
  end if;
  return t;
end $$;

create or replace function public.normalizar_complemento(p text) returns text
language plpgsql immutable as $$
declare t text := nullif(trim(coalesce(p, '')), '');
begin
  if t is null then return null; end if;
  if char_length(t) > 80 then raise exception 'Complemento muito longo (máx. 80 caracteres)'; end if;
  return t;
end $$;

drop function if exists public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric);
drop function if exists public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision);

create or replace function public.criar_pedido(
  p_retirada text, p_entrega text, p_item text,
  p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8,
  p_rota_km numeric default null,
  p_ret_numero text default null, p_ret_complemento text default null,
  p_ent_numero text default null, p_ent_complemento text default null)
returns table(pedido_id uuid, valor numeric, km numeric, cod text)
language plpgsql security definer set search_path = public as $$
declare q record; v_id uuid; v_cod text;
  v_ret_num text; v_ent_num text; v_ret_comp text; v_ent_comp text;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('cliente','admin')) then
    raise exception 'Apenas clientes podem pedir';
  end if;
  v_ret_num := normalizar_numero(p_ret_numero);
  v_ent_num := normalizar_numero(p_ent_numero);
  v_ret_comp := normalizar_complemento(p_ret_complemento);
  v_ent_comp := normalizar_complemento(p_ent_complemento);
  if v_ret_num is null or v_ent_num is null then
    raise exception 'Informe o número da retirada e da entrega (use S/N se não houver)';
  end if;
  if exists (select 1 from pedidos where cliente_id = auth.uid() and status in ('procurando','aceito','coletado')) then
    raise exception 'Você já tem um pedido em andamento';
  end if;
  select * into q from cotar_preco(p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng, p_rota_km);
  insert into pedidos (cliente_id, retirada, entrega, item, ret_lat, ret_lng, ent_lat, ent_lng, distancia_km, preco,
                       ret_numero, ret_complemento, ent_numero, ent_complemento)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item, 60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng,
          q.distancia_km, q.preco, v_ret_num, v_ret_comp, v_ent_num, v_ent_comp)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

drop function if exists public.meu_pedido_ativo();
create or replace function public.meu_pedido_ativo()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text, codigo text,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, c.codigo,
         p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento
  from pedidos p join pedido_codigos c on c.pedido_id = p.id
  where p.cliente_id = auth.uid() and p.status in ('procurando','aceito','coletado')
  order by p.criado_em desc limit 1
$$;

drop function if exists public.meus_pedidos();
create or replace function public.meus_pedidos()
returns table(id uuid, criado_em timestamptz, retirada text, entrega text, item text, preco numeric, distancia_km numeric,
  status text, motoboy_nome text, nota int, ent_lat float8, ent_lng float8,
  ret_numero text, ret_complemento text, ent_numero text, ent_complemento text)
language sql stable security definer set search_path = public as $$
  select p.id, p.criado_em, p.retirada, p.entrega, p.item, p.preco, p.distancia_km, p.status, pr.nome, a.nota,
         p.ent_lat, p.ent_lng, p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento
  from pedidos p left join profiles pr on pr.id = p.motoboy_id left join avaliacoes a on a.pedido_id = p.id
  where p.cliente_id = auth.uid() order by p.criado_em desc limit 50
$$;

drop function if exists public.pedidos_abertos();
create or replace function public.pedidos_abertos()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, distancia_km numeric,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not motoboy_aprovado() then raise exception 'Motoboy não aprovado'; end if;
  return query select p.id, p.retirada, p.entrega, p.item, p.preco, p.distancia_km,
                      p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento
    from pedidos p where p.status = 'procurando' order by p.criado_em limit 20;
end $$;

drop function if exists public.minha_corrida();
create or replace function public.minha_corrida()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text,
              ret_lat float8, ret_lng float8, ent_lat float8, ent_lng float8,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, p.ret_lat, p.ret_lng, p.ent_lat, p.ent_lng,
         p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento
  from pedidos p where p.motoboy_id = auth.uid() and p.status in ('aceito','coletado')
  order by p.criado_em desc limit 1
$$;

drop function if exists public.admin_pedidos();
create or replace function public.admin_pedidos()
returns table(id uuid, criado_em timestamptz, cliente text, motoboy text, retirada text, entrega text,
  distancia_km numeric, preco numeric, status text,
  ret_numero text, ret_complemento text, ent_numero text, ent_complemento text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select p.id, p.criado_em, c.nome, mp.nome, p.retirada, p.entrega, p.distancia_km, p.preco, p.status,
                      p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento
    from pedidos p left join profiles c on c.id = p.cliente_id left join profiles mp on mp.id = p.motoboy_id
    order by p.criado_em desc limit 200;
end $$;

-- ===== 2. Chat da corrida (só cliente e motoboy da corrida, só enquanto aceita/coletada) =====
create table if not exists public.mensagens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  texto text not null check (char_length(texto) between 1 and 500),
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index if not exists mensagens_pedido_em_idx on public.mensagens (pedido_id, criado_em);
create index if not exists mensagens_autor_em_idx on public.mensagens (autor_id, criado_em);

alter table public.mensagens enable row level security;

-- Parte da corrida ativa. security invoker: o RLS de pedidos já esconde a linha de quem não é parte;
-- o status restringe o chat a aceito/coletado. (select auth.uid()) avalia uma vez.
create or replace function public.pedido_chat_ativo(p_pedido uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from pedidos p
    where p.id = p_pedido
      and p.status in ('aceito', 'coletado')
      and (p.cliente_id = (select auth.uid()) or p.motoboy_id = (select auth.uid()))
  )
$$;

drop policy if exists "mensagens: ler" on public.mensagens;
create policy "mensagens: ler" on public.mensagens for select to authenticated
  using ((select public.pedido_chat_ativo(pedido_id)));

drop policy if exists "mensagens: enviar" on public.mensagens;
create policy "mensagens: enviar" on public.mensagens for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and (select public.pedido_chat_ativo(pedido_id))
  );

drop policy if exists "mensagens: marcar lida" on public.mensagens;
create policy "mensagens: marcar lida" on public.mensagens for update to authenticated
  using (
    autor_id is distinct from (select auth.uid())
    and (select public.pedido_chat_ativo(pedido_id))
  )
  with check (
    autor_id is distinct from (select auth.uid())
    and (select public.pedido_chat_ativo(pedido_id))
  );

revoke all on public.mensagens from public, anon, authenticated;
grant select (id, pedido_id, autor_id, texto, criado_em, lida_em) on public.mensagens to authenticated;
grant insert (pedido_id, autor_id, texto) on public.mensagens to authenticated;
grant update (lida_em) on public.mensagens to authenticated;
grant select, insert, update, delete on public.mensagens to service_role;

create or replace function public.mensagens_antes_insert() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.texto := trim(coalesce(new.texto, ''));
  new.lida_em := null;
  if char_length(new.texto) < 1 then raise exception 'Escreva uma mensagem'; end if;
  if char_length(new.texto) > 500 then raise exception 'Mensagem muito longa (máx. 500)'; end if;
  if current_user in ('authenticated', 'anon') then
    if (select auth.uid()) is null or new.autor_id is distinct from (select auth.uid()) then
      raise exception 'Não autorizado';
    end if;
    if (select count(*) from mensagens where autor_id = (select auth.uid()) and criado_em > now() - interval '1 minute') >= 20 then
      raise exception 'Muitas mensagens. Espere um instante.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.mensagens_antes_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id or new.pedido_id is distinct from old.pedido_id
       or new.autor_id is distinct from old.autor_id or new.texto is distinct from old.texto
       or new.criado_em is distinct from old.criado_em then
      raise exception 'Só é possível marcar a mensagem como lida';
    end if;
    if old.autor_id is not distinct from (select auth.uid()) then
      raise exception 'Quem enviou não marca a própria mensagem';
    end if;
    if new.lida_em is null then raise exception 'Não é possível desmarcar a leitura'; end if;
  end if;
  return new;
end $$;

drop trigger if exists mensagens_bi on public.mensagens;
create trigger mensagens_bi before insert on public.mensagens
  for each row execute function public.mensagens_antes_insert();
drop trigger if exists mensagens_bu on public.mensagens;
create trigger mensagens_bu before update on public.mensagens
  for each row execute function public.mensagens_antes_update();

alter table public.mensagens replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens'
  ) then
    alter publication supabase_realtime add table public.mensagens;
  end if;
end $$;

-- ===== 3. Anonimização (exclusão de conta) e retenção diária =====
create or replace function public.excluir_dados_usuario(p_uid uuid, p_origem text default 'app')
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; n int; v_id bigint;
begin
  select role into v_role from profiles where id = p_uid;
  if exists (select 1 from pedidos where (cliente_id = p_uid or motoboy_id = p_uid) and status in ('procurando','aceito','coletado')) then
    raise exception 'Há um pedido em andamento. Conclua ou cancele antes de excluir a conta.';
  end if;
  update mensagens set texto = 'Mensagem removida (LGPD)',
         autor_id = case when autor_id = p_uid then null else autor_id end
   where autor_id = p_uid
      or pedido_id in (select id from pedidos where cliente_id = p_uid or motoboy_id = p_uid);
  update pedidos set retirada = 'Endereço removido (LGPD)', entrega = 'Endereço removido (LGPD)',
         ret_numero = null, ret_complemento = null, ent_numero = null, ent_complemento = null,
         ret_lat = round(ret_lat::numeric, 2), ret_lng = round(ret_lng::numeric, 2),
         ent_lat = round(ent_lat::numeric, 2), ent_lng = round(ent_lng::numeric, 2),
         anonimizado_em = now()
   where cliente_id = p_uid or motoboy_id = p_uid;
  get diagnostics n = row_count;
  update avaliacoes set comentario = null where cliente_id = p_uid or motoboy_id = p_uid;
  delete from posicoes where motoboy_id = p_uid;
  delete from device_tokens where user_id = p_uid;
  insert into solicitacoes_exclusao (user_hash, papel, origem, pedidos_anonimizados)
  values (encode(extensions.digest(p_uid::text, 'sha256'), 'hex'), v_role, p_origem, n) returning id into v_id;
  return json_build_object('solicitacao', v_id, 'pedidos', n, 'papel', v_role);
end $$;

-- O cron eja_limpar_gps (03:15) já chama esta função: mensagens entram na mesma rotina.
create or replace function privado.limpar_gps() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from mensagens m using pedidos p
   where p.id = m.pedido_id
     and (m.criado_em < now() - interval '90 days'
          or (p.status in ('entregue','cancelado')
              and coalesce(p.entregue_em, p.cancelado_em, p.criado_em) < now() - interval '90 days'));
  delete from posicoes po using pedidos p where p.id = po.pedido_id
    and (po.em < now() - interval '90 days'
         or (p.status in ('entregue','cancelado') and coalesce(p.entregue_em, p.cancelado_em, p.criado_em) < now() - interval '90 days'));
  get diagnostics n = row_count;
  update motoboys set lat = null, lng = null where local_em < now() - interval '90 days';
  return n;
end $$;

-- ===== 4. Permissões =====
revoke all on function public.normalizar_numero(text) from public, anon, authenticated;
revoke all on function public.normalizar_complemento(text) from public, anon, authenticated;
revoke all on function public.mensagens_antes_insert() from public, anon, authenticated;
revoke all on function public.mensagens_antes_update() from public, anon, authenticated;
revoke all on function public.pedido_chat_ativo(uuid) from public, anon;
revoke all on function public.excluir_dados_usuario(uuid, text) from public, anon, authenticated;

grant execute on function public.pedido_chat_ativo(uuid) to authenticated;
grant execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text) to authenticated;
grant execute on function public.meu_pedido_ativo() to authenticated;
grant execute on function public.meus_pedidos() to authenticated;
grant execute on function public.pedidos_abertos() to authenticated;
grant execute on function public.minha_corrida() to authenticated;
grant execute on function public.admin_pedidos() to authenticated;
grant execute on function public.excluir_dados_usuario(uuid, text) to service_role;
