-- Como o cliente vai pagar o motoboy na hora (PIX, dinheiro ou cartão na maquininha).
-- Não cobra pelo app. Pedidos antigos ficam com NULL. O check aceita NULL
-- porque NULL in (...) não falha no Postgres; o criar_pedido exige um dos três.
-- RLS continua por linha: quem já lia o pedido passa a ler a coluna também.

alter table public.pedidos
  add column if not exists forma_pagamento text;

alter table public.pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table public.pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento in ('pix', 'dinheiro', 'cartao'));

drop function if exists public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text);
drop function if exists public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text);

create or replace function public.criar_pedido(
  p_retirada text, p_entrega text, p_item text,
  p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8,
  p_rota_km numeric default null,
  p_ret_numero text default null, p_ret_complemento text default null,
  p_ent_numero text default null, p_ent_complemento text default null,
  p_forma_pagamento text default null)
returns table(pedido_id uuid, valor numeric, km numeric, cod text)
language plpgsql security definer set search_path = public as $$
declare q record; v_id uuid; v_cod text;
  v_ret_num text; v_ent_num text; v_ret_comp text; v_ent_comp text;
  v_pag text := lower(trim(coalesce(p_forma_pagamento, '')));
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
  if v_pag not in ('pix', 'dinheiro', 'cartao') then
    raise exception 'Escolha como vai pagar o motoboy: PIX, dinheiro ou cartão';
  end if;
  if exists (select 1 from pedidos where cliente_id = auth.uid() and status in ('procurando','aceito','coletado')) then
    raise exception 'Você já tem um pedido em andamento';
  end if;
  select * into q from cotar_preco(p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng, p_rota_km);
  insert into pedidos (cliente_id, retirada, entrega, item, ret_lat, ret_lng, ent_lat, ent_lng, distancia_km, preco,
                       ret_numero, ret_complemento, ent_numero, ent_complemento, forma_pagamento)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item, 60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng,
          q.distancia_km, q.preco, v_ret_num, v_ret_comp, v_ent_num, v_ent_comp, v_pag)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

drop function if exists public.meu_pedido_ativo();
create or replace function public.meu_pedido_ativo()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text, codigo text,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text,
              forma_pagamento text)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, c.codigo,
         p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento, p.forma_pagamento
  from pedidos p join pedido_codigos c on c.pedido_id = p.id
  where p.cliente_id = auth.uid() and p.status in ('procurando','aceito','coletado')
  order by p.criado_em desc limit 1
$$;

drop function if exists public.pedidos_abertos();
create or replace function public.pedidos_abertos()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, distancia_km numeric,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text,
              forma_pagamento text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not motoboy_aprovado() then raise exception 'Motoboy não aprovado'; end if;
  return query select p.id, p.retirada, p.entrega, p.item, p.preco, p.distancia_km,
                      p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento, p.forma_pagamento
    from pedidos p where p.status = 'procurando' order by p.criado_em limit 20;
end $$;

drop function if exists public.minha_corrida();
create or replace function public.minha_corrida()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text,
              ret_lat float8, ret_lng float8, ent_lat float8, ent_lng float8,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text,
              forma_pagamento text)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, p.ret_lat, p.ret_lng, p.ent_lat, p.ent_lng,
         p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento, p.forma_pagamento
  from pedidos p where p.motoboy_id = auth.uid() and p.status in ('aceito','coletado')
  order by p.criado_em desc limit 1
$$;

drop function if exists public.admin_pedidos();
create or replace function public.admin_pedidos()
returns table(id uuid, criado_em timestamptz, cliente text, motoboy text, retirada text, entrega text,
  distancia_km numeric, preco numeric, status text,
  ret_numero text, ret_complemento text, ent_numero text, ent_complemento text,
  forma_pagamento text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select p.id, p.criado_em, c.nome, mp.nome, p.retirada, p.entrega, p.distancia_km, p.preco, p.status,
                      p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento, p.forma_pagamento
    from pedidos p left join profiles c on c.id = p.cliente_id left join profiles mp on mp.id = p.motoboy_id
    order by p.criado_em desc limit 200;
end $$;

-- CREATE OR REPLACE devolve EXECUTE para public. O app só chama autenticado.
revoke execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text) from public, anon;
revoke execute on function public.meu_pedido_ativo() from public, anon;
revoke execute on function public.pedidos_abertos() from public, anon;
revoke execute on function public.minha_corrida() from public, anon;
revoke execute on function public.admin_pedidos() from public, anon;

grant execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.meu_pedido_ativo() to authenticated;
grant execute on function public.pedidos_abertos() to authenticated;
grant execute on function public.minha_corrida() to authenticated;
grant execute on function public.admin_pedidos() to authenticated;
