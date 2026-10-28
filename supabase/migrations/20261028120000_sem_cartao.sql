-- Cartão sai das opções novas. Pedidos antigos com 'cartao' continuam legíveis:
-- o check novo é NOT VALID, então não varre as linhas que já existem.
-- Insert e update novos só aceitam pix ou dinheiro (NULL continua válido no check;
-- criar_pedido exige um dos dois).

alter table public.pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table public.pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento in ('pix', 'dinheiro')) not valid;

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
                       ret_numero, ret_complemento, ent_numero, ent_complemento, forma_pagamento)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item, 60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng,
          q.distancia_km, q.preco, v_ret_num, v_ret_comp, v_ent_num, v_ent_comp, v_pag)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

revoke execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text) from public, anon;
grant execute on function public.criar_pedido(text, text, text, double precision, double precision, double precision, double precision, numeric, text, text, text, text, text) to authenticated;

-- Ao apagar a conta, a forma some junto com o endereço. Um pedido antigo com
-- 'cartao' continua legível até lá; o update da exclusão não esbarra no check novo.
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
         forma_pagamento = null,
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

revoke all on function public.excluir_dados_usuario(uuid, text) from public, anon, authenticated;
grant execute on function public.excluir_dados_usuario(uuid, text) to service_role;
