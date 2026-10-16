-- Avaliação do motoboy pelo cliente (1 a 5 estrelas) + histórico do cliente
create table if not exists public.avaliacoes (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  cliente_id uuid not null references public.profiles(id),
  motoboy_id uuid not null references public.motoboys(id),
  nota int not null check (nota between 1 and 5),
  comentario text check (char_length(comentario) <= 300),
  criado_em timestamptz not null default now()
);
alter table public.avaliacoes enable row level security;
create policy "avaliacoes: cliente vê as suas" on public.avaliacoes for select to authenticated using (cliente_id = auth.uid());
create policy "avaliacoes: admin" on public.avaliacoes for select to authenticated using (public.is_admin());
revoke all on public.avaliacoes from anon, authenticated;
grant select on public.avaliacoes to authenticated;

create or replace function public.avaliar_pedido(p_id uuid, p_nota int, p_comentario text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v pedidos;
begin
  select * into v from pedidos where id = p_id and cliente_id = auth.uid() and status = 'entregue';
  if not found then return false; end if;
  insert into avaliacoes (pedido_id, cliente_id, motoboy_id, nota, comentario)
  values (p_id, auth.uid(), v.motoboy_id, p_nota, left(trim(p_comentario), 300))
  on conflict (pedido_id) do update set nota = excluded.nota, comentario = excluded.comentario;
  return true;
end $$;

-- Histórico do cliente (Atividade)
create or replace function public.meus_pedidos()
returns table(id uuid, criado_em timestamptz, retirada text, entrega text, item text, preco numeric, distancia_km numeric,
  status text, motoboy_nome text, nota int, ent_lat float8, ent_lng float8)
language sql stable security definer set search_path = public as $$
  select p.id, p.criado_em, p.retirada, p.entrega, p.item, p.preco, p.distancia_km, p.status, pr.nome, a.nota, p.ent_lat, p.ent_lng
  from pedidos p left join profiles pr on pr.id = p.motoboy_id left join avaliacoes a on a.pedido_id = p.id
  where p.cliente_id = auth.uid() order by p.criado_em desc limit 50
$$;
revoke execute on function public.avaliar_pedido(uuid,int,text) from public, anon;
revoke execute on function public.meus_pedidos() from public, anon;
grant execute on function public.avaliar_pedido(uuid,int,text), public.meus_pedidos() to authenticated;
