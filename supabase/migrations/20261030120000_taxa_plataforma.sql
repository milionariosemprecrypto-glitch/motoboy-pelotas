-- Taxa da plataforma: 20% do preço cheio. O cliente continua pagando o total ao motoboy
-- (PIX ou dinheiro). valor_plataforma e valor_motoboy só registram o acerto futuro.
-- A chave fica em configuracao, não no pedido do app, para o cliente não escolher a taxa.

create table if not exists public.configuracao (
  chave text primary key,
  valor numeric not null
);
insert into public.configuracao (chave, valor) values ('taxa_plataforma', 20)
on conflict (chave) do update set valor = excluded.valor;

alter table public.configuracao enable row level security;
drop policy if exists "configuracao: leitura" on public.configuracao;
create policy "configuracao: leitura" on public.configuracao
  for select to authenticated using (true);
revoke all on public.configuracao from public, anon, authenticated;
grant select on public.configuracao to authenticated;

alter table public.pedidos
  add column if not exists valor_plataforma numeric(10,2),
  add column if not exists valor_motoboy numeric(10,2);

create or replace function public.partir_preco(p_preco numeric)
returns table(valor_plataforma numeric, valor_motoboy numeric, taxa_percent numeric)
language plpgsql stable security definer set search_path = public as $$
declare taxa numeric; plat numeric; cheio numeric := coalesce(p_preco, 0);
begin
  taxa := coalesce((select c.valor from public.configuracao c where c.chave = 'taxa_plataforma'), 20);
  plat := round(cheio * taxa / 100, 2);
  return query select plat, cheio - plat, taxa;
end $$;
revoke all on function public.partir_preco(numeric) from public, anon, authenticated;

drop function if exists public.cotar_preco(double precision, double precision, double precision, double precision, numeric) cascade;

create or replace function public.cotar_preco(p_ret_lat float8, p_ret_lng float8, p_ent_lat float8, p_ent_lng float8,
  p_rota_km numeric default null)
returns table(distancia_km numeric, preco numeric, fonte text, valor_plataforma numeric, valor_motoboy numeric, taxa_percent numeric)
language plpgsql stable security definer set search_path = public as $$
declare reta numeric; km numeric; f text; v_preco numeric; v_plat numeric; v_moto numeric; v_taxa numeric;
begin
  reta := haversine_km(p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng);
  if p_rota_km is not null and p_rota_km between reta * cfg('rota_min_fator') and reta * cfg('rota_max_fator') + 0.5 then
    km := round(p_rota_km, 2); f := 'rota';
  else
    km := round(reta * cfg('fator_rota'), 2); f := 'estimativa';
  end if;
  if km > cfg('km_maximo') then raise exception 'Distância acima do limite de % km', cfg('km_maximo'); end if;
  v_preco := round(greatest(cfg('tarifa_minima'), km * cfg('preco_km')), 2);
  select p.valor_plataforma, p.valor_motoboy, p.taxa_percent into v_plat, v_moto, v_taxa from partir_preco(v_preco) p;
  return query select km, v_preco, f, v_plat, v_moto, v_taxa;
end $$;

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
  if v_pag not in ('pix', 'dinheiro') then
    raise exception 'Escolha como vai pagar o motoboy: PIX ou dinheiro';
  end if;
  if exists (select 1 from pedidos where cliente_id = auth.uid() and status in ('procurando','aceito','coletado')) then
    raise exception 'Você já tem um pedido em andamento';
  end if;
  select * into q from cotar_preco(p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng, p_rota_km);
  insert into pedidos (cliente_id, retirada, entrega, item, ret_lat, ret_lng, ent_lat, ent_lng, distancia_km, preco,
                       ret_numero, ret_complemento, ent_numero, ent_complemento, forma_pagamento,
                       valor_plataforma, valor_motoboy)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item, 60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng,
          q.distancia_km, q.preco, v_ret_num, v_ret_comp, v_ent_num, v_ent_comp, v_pag,
          q.valor_plataforma, q.valor_motoboy)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

drop function if exists public.pedidos_abertos();
create or replace function public.pedidos_abertos()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, distancia_km numeric,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text,
              forma_pagamento text, valor_plataforma numeric, valor_motoboy numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not motoboy_aprovado() then raise exception 'Motoboy não aprovado'; end if;
  return query select p.id, p.retirada, p.entrega, p.item, p.preco, p.distancia_km,
                      p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento, p.forma_pagamento,
                      p.valor_plataforma, p.valor_motoboy
    from pedidos p where p.status = 'procurando' order by p.criado_em limit 20;
end $$;

drop function if exists public.minha_corrida();
create or replace function public.minha_corrida()
returns table(id uuid, retirada text, entrega text, item text, preco numeric, status text,
              ret_lat float8, ret_lng float8, ent_lat float8, ent_lng float8,
              ret_numero text, ret_complemento text, ent_numero text, ent_complemento text,
              forma_pagamento text, valor_plataforma numeric, valor_motoboy numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.item, p.preco, p.status, p.ret_lat, p.ret_lng, p.ent_lat, p.ent_lng,
         p.ret_numero, p.ret_complemento, p.ent_numero, p.ent_complemento, p.forma_pagamento,
         p.valor_plataforma, p.valor_motoboy
  from pedidos p where p.motoboy_id = auth.uid() and p.status in ('aceito','coletado')
  order by p.criado_em desc limit 1
$$;

revoke execute on function public.cotar_preco(double precision, double precision, double precision, double precision, numeric) from public, anon;
revoke execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text) from public, anon;
revoke execute on function public.pedidos_abertos() from public, anon;
revoke execute on function public.minha_corrida() from public, anon;
grant execute on function public.cotar_preco(double precision, double precision, double precision, double precision, numeric) to authenticated;
grant execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.pedidos_abertos() to authenticated;
grant execute on function public.minha_corrida() to authenticated;
