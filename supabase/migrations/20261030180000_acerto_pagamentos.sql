-- Cartão volta. Acerto: PIX/cartão creditam 80% ao motoboy; dinheiro gera débito de 20%.
-- A taxa continua em public.config (chave taxa_plataforma = 20). Sem chave do Mercado Pago
-- a cobrança fica simulada. O cliente não é cobrado de verdade.

insert into public.config (chave, valor, descricao) values
  ('taxa_plataforma', 20, 'Percentual da plataforma sobre o preço cheio da corrida')
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao;

create or replace function public.partir_preco(p_preco numeric)
returns table(valor_plataforma numeric, valor_motoboy numeric, taxa_percent numeric)
language plpgsql stable security definer set search_path = public as $$
declare taxa numeric; plat numeric; cheio numeric := coalesce(p_preco, 0);
begin
  taxa := coalesce(cfg('taxa_plataforma'), 20);
  plat := round(cheio * taxa / 100, 2);
  return query select plat, cheio - plat, taxa;
end $$;
revoke all on function public.partir_preco(numeric) from public, anon, authenticated;

alter table public.pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table public.pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento is null or forma_pagamento in ('pix', 'dinheiro', 'cartao'));

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
                       ret_numero, ret_complemento, ent_numero, ent_complemento, forma_pagamento,
                       valor_plataforma, valor_motoboy)
  values (auth.uid(), trim(p_retirada), trim(p_entrega), left(p_item, 60), p_ret_lat, p_ret_lng, p_ent_lat, p_ent_lng,
          q.distancia_km, q.preco, v_ret_num, v_ret_comp, v_ent_num, v_ent_comp, v_pag,
          q.valor_plataforma, q.valor_motoboy)
  returning id into v_id;
  insert into pedido_codigos (pedido_id) values (v_id) returning codigo into v_cod;
  return query select v_id, q.preco, q.distancia_km, v_cod;
end $$;

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null unique references public.pedidos(id) on delete cascade,
  forma text not null check (forma in ('pix', 'cartao', 'dinheiro')),
  status text not null check (status in ('simulado', 'pendente', 'pago', 'falhou')),
  valor_total numeric(10,2) not null,
  valor_plataforma numeric(10,2) not null,
  valor_motoboy numeric(10,2) not null,
  provedor text not null default 'mock',
  referencia text,
  checkout_url text,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);

create table if not exists public.ledger_motoboy (
  id uuid primary key default gen_random_uuid(),
  motoboy_id uuid not null references public.profiles(id),
  pedido_id uuid references public.pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('repasse', 'taxa_dinheiro', 'saque')),
  valor numeric(10,2) not null,
  descricao text,
  criado_em timestamptz not null default now(),
  unique (pedido_id, tipo)
);

create table if not exists public.recebimento_motoboy (
  motoboy_id uuid primary key references public.motoboys(id) on delete cascade,
  tipo_chave text check (tipo_chave in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  chave_pix text,
  banco text,
  agencia text,
  conta text,
  tipo_conta text check (tipo_conta is null or tipo_conta in ('corrente', 'poupanca')),
  titular text,
  atualizado_em timestamptz not null default now()
);

alter table public.pagamentos enable row level security;
alter table public.ledger_motoboy enable row level security;
alter table public.recebimento_motoboy enable row level security;
drop policy if exists "pagamentos: leitura" on public.pagamentos;
create policy "pagamentos: leitura" on public.pagamentos for select to authenticated
  using (
    exists (select 1 from pedidos p where p.id = pedido_id and (p.cliente_id = (select auth.uid()) or p.motoboy_id = (select auth.uid())))
    or public.is_admin()
  );
drop policy if exists "ledger: leitura" on public.ledger_motoboy;
create policy "ledger: leitura" on public.ledger_motoboy for select to authenticated
  using (motoboy_id = (select auth.uid()) or public.is_admin());
drop policy if exists "recebimento: leitura" on public.recebimento_motoboy;
create policy "recebimento: leitura" on public.recebimento_motoboy for select to authenticated
  using (motoboy_id = (select auth.uid()) or public.is_admin());
revoke all on public.pagamentos from public, anon, authenticated;
revoke all on public.ledger_motoboy from public, anon, authenticated;
revoke all on public.recebimento_motoboy from public, anon, authenticated;
grant select on public.pagamentos to authenticated;
grant select on public.ledger_motoboy to authenticated;
grant select on public.recebimento_motoboy to authenticated;

create or replace function public.motoboy_pronto_receber(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from recebimento_motoboy r
    join motoboys m on m.id = r.motoboy_id
    where r.motoboy_id = p_id
      and length(trim(coalesce(r.chave_pix, ''))) >= 5
      and length(trim(coalesce(r.titular, ''))) >= 3
      and m.cpf ~ '^[0-9]{11}$'
  )
$$;
revoke all on function public.motoboy_pronto_receber(uuid) from public, anon, authenticated;

create or replace function public.iniciar_cobranca(p_pedido uuid)
returns table(modo text, status text, mensagem text, checkout_url text)
language plpgsql security definer set search_path = public as $$
declare p pedidos; v_status text; v_modo text; v_msg text; v_url text;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  select * into p from pedidos where id = p_pedido and cliente_id = auth.uid();
  if not found then raise exception 'Pedido não encontrado'; end if;
  if p.forma_pagamento = 'dinheiro' then
    v_modo := 'especie'; v_status := 'pago'; v_url := null;
    v_msg := 'Pague o total ao motoboy em dinheiro. A parte da plataforma entra no acerto depois.';
  elsif p.forma_pagamento in ('pix', 'cartao') then
    v_modo := 'simulado'; v_status := 'simulado'; v_url := null;
    v_msg := 'Cobrança simulada: falta a chave do Mercado Pago. Você não foi cobrado.';
  else
    raise exception 'Forma de pagamento inválida';
  end if;
  insert into pagamentos (pedido_id, forma, status, valor_total, valor_plataforma, valor_motoboy, provedor, pago_em)
  values (p.id, p.forma_pagamento, v_status, p.preco, coalesce(p.valor_plataforma, 0), coalesce(p.valor_motoboy, 0),
          case when v_modo = 'especie' then 'especie' else 'mock' end,
          case when v_status = 'pago' then now() else null end)
  on conflict (pedido_id) do update set status = excluded.status, pago_em = excluded.pago_em, provedor = excluded.provedor
  where pagamentos.status <> 'pago';
  return query select v_modo, v_status, v_msg, v_url;
end $$;

create or replace function public.liquidar_pedido(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p pedidos; pago boolean;
begin
  select * into p from pedidos where id = p_id;
  if not found or p.status <> 'entregue' or p.motoboy_id is null then return; end if;
  if p.forma_pagamento = 'dinheiro' then
    insert into ledger_motoboy (motoboy_id, pedido_id, tipo, valor, descricao)
    values (p.motoboy_id, p.id, 'taxa_dinheiro', -coalesce(p.valor_plataforma, 0),
            'Taxa da corrida em dinheiro, a descontar nos próximos repasses')
    on conflict (pedido_id, tipo) do nothing;
  elsif p.forma_pagamento in ('pix', 'cartao') then
    select exists (select 1 from pagamentos g where g.pedido_id = p.id and g.status in ('pago', 'simulado')) into pago;
    if not pago then return; end if;
    insert into ledger_motoboy (motoboy_id, pedido_id, tipo, valor, descricao)
    values (p.motoboy_id, p.id, 'repasse', coalesce(p.valor_motoboy, 0),
            case when motoboy_pronto_receber(p.motoboy_id)
              then 'Repasse da corrida'
              else 'Repasse retido até completar o cadastro para receber' end)
    on conflict (pedido_id, tipo) do nothing;
  end if;
end $$;
revoke all on function public.liquidar_pedido(uuid) from public, anon, authenticated;
grant execute on function public.liquidar_pedido(uuid) to service_role;

create or replace function public.trg_liquidar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' then
    perform liquidar_pedido(new.id);
  end if;
  return new;
end $$;
drop trigger if exists pedidos_liquidar on public.pedidos;
create trigger pedidos_liquidar after update of status on public.pedidos
  for each row execute function public.trg_liquidar_pedido();
revoke all on function public.trg_liquidar_pedido() from public, anon, authenticated;

create or replace function public.meu_saldo()
returns table(saldo numeric, debitos numeric, creditos numeric, pronto boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.valor), 0),
         coalesce(sum(l.valor) filter (where l.tipo = 'taxa_dinheiro'), 0),
         coalesce(sum(l.valor) filter (where l.tipo = 'repasse'), 0),
         public.motoboy_pronto_receber(auth.uid())
  from ledger_motoboy l
  where l.motoboy_id = auth.uid()
$$;

create or replace function public.meu_recebimento()
returns table(tipo_chave text, chave_pix text, titular text, cpf text, banco text, agencia text, conta text, tipo_conta text, pronto boolean)
language sql stable security definer set search_path = public as $$
  select r.tipo_chave, r.chave_pix, r.titular, m.cpf, r.banco, r.agencia, r.conta, r.tipo_conta,
         public.motoboy_pronto_receber(auth.uid())
  from motoboys m
  left join recebimento_motoboy r on r.motoboy_id = m.id
  where m.id = auth.uid()
$$;

create or replace function public.salvar_recebimento(
  p_tipo_chave text, p_chave_pix text, p_titular text, p_cpf text,
  p_banco text, p_agencia text, p_conta text, p_tipo_conta text)
returns table(pronto boolean, mensagem text)
language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if not exists (select 1 from motoboys where id = auth.uid()) then
    raise exception 'Só motoboy cadastrado pode receber';
  end if;
  if length(v_cpf) = 11 then
    if not cpf_valido(v_cpf) then raise exception 'CPF inválido'; end if;
    update motoboys set cpf = v_cpf where id = auth.uid() and (cpf is null or cpf = v_cpf);
  end if;
  insert into recebimento_motoboy (motoboy_id, tipo_chave, chave_pix, titular, banco, agencia, conta, tipo_conta, atualizado_em)
  values (auth.uid(), nullif(p_tipo_chave, ''), nullif(trim(p_chave_pix), ''), nullif(trim(p_titular), ''),
          nullif(trim(p_banco), ''), nullif(trim(p_agencia), ''), nullif(trim(p_conta), ''), nullif(p_tipo_conta, ''), now())
  on conflict (motoboy_id) do update set
    tipo_chave = excluded.tipo_chave, chave_pix = excluded.chave_pix, titular = excluded.titular,
    banco = excluded.banco, agencia = excluded.agencia, conta = excluded.conta, tipo_conta = excluded.tipo_conta,
    atualizado_em = now();
  return query select public.motoboy_pronto_receber(auth.uid()),
    case when public.motoboy_pronto_receber(auth.uid()) then 'Pronto para receber.' else 'Ainda falta chave PIX, titular ou CPF.' end;
end $$;

create or replace function public.meu_ir(p_ano int, p_mes int default null)
returns table(entregue_em timestamptz, forma text, bruto numeric, taxa numeric, liquido numeric)
language sql stable security definer set search_path = public as $$
  select p.entregue_em, p.forma_pagamento, p.preco, coalesce(p.valor_plataforma, 0),
         case when p.forma_pagamento = 'dinheiro' then 0
              else coalesce(p.valor_motoboy, 0) end
  from pedidos p
  where p.motoboy_id = auth.uid() and p.status = 'entregue'
    and p.entregue_em >= make_date(p_ano, coalesce(p_mes, 1), 1)
    and p.entregue_em < case when p_mes is null then make_date(p_ano + 1, 1, 1) else (make_date(p_ano, p_mes, 1) + interval '1 month') end
  order by p.entregue_em
$$;

create or replace function public.admin_financeiro(p_inicio date default null, p_fim date default null)
returns table(taxa_arrecadada numeric, repassado numeric, debito_dinheiro numeric, pedidos int)
language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz := coalesce(p_inicio::timestamptz, '-infinity');
        fim timestamptz := coalesce((p_fim + 1)::timestamptz, 'infinity');
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query
  select coalesce(sum(p.valor_plataforma), 0),
         coalesce((select sum(l.valor) from ledger_motoboy l where l.tipo = 'repasse' and l.criado_em >= ini and l.criado_em < fim), 0),
         coalesce((select sum(-l.valor) from ledger_motoboy l where l.tipo = 'taxa_dinheiro' and l.criado_em >= ini and l.criado_em < fim), 0),
         count(*)::int
  from pedidos p
  where p.status = 'entregue' and p.entregue_em >= ini and p.entregue_em < fim;
end $$;

revoke execute on function public.iniciar_cobranca(uuid) from public, anon;
revoke execute on function public.meu_saldo() from public, anon;
revoke execute on function public.meu_recebimento() from public, anon;
revoke execute on function public.salvar_recebimento(text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.meu_ir(int, int) from public, anon;
revoke execute on function public.admin_financeiro(date, date) from public, anon;
grant execute on function public.iniciar_cobranca(uuid) to authenticated;
grant execute on function public.meu_saldo() to authenticated;
grant execute on function public.meu_recebimento() to authenticated;
grant execute on function public.salvar_recebimento(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.meu_ir(int, int) to authenticated;
grant execute on function public.admin_financeiro(date, date) to authenticated;

drop function if exists public.ganhos();
create or replace function public.ganhos()
returns table(id uuid, retirada text, entrega text, preco numeric, entregue_em timestamptz,
              forma_pagamento text, valor_plataforma numeric, valor_motoboy numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.retirada, p.entrega, p.preco, p.entregue_em, p.forma_pagamento,
         p.valor_plataforma, p.valor_motoboy
  from pedidos p
  where p.motoboy_id = auth.uid() and p.status = 'entregue'
  order by p.entregue_em desc limit 50
$$;
revoke execute on function public.ganhos() from public, anon;
grant execute on function public.ganhos() to authenticated;
