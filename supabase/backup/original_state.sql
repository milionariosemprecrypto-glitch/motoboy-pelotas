-- Baseline: estado ORIGINAL do banco (dump 2026-10-15, antes do É-Já v1). Backup para recriar se preciso.

create table if not exists public.orders (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), pickup_address text not null, delivery_address text not null, item_type text not null, estimated_price numeric not null check (estimated_price >= 0), status text not null default 'pending' check (status in ('pending','accepted','picked_up','in_transit','completed','cancelled')));
alter table public.orders enable row level security;
create policy "Public can submit pending orders" on public.orders for insert to anon with check (((status = 'pending'::text) AND ((length(TRIM(BOTH FROM pickup_address)) >= 3) AND (length(TRIM(BOTH FROM pickup_address)) <= 300)) AND ((length(TRIM(BOTH FROM delivery_address)) >= 3) AND (length(TRIM(BOTH FROM delivery_address)) <= 300)) AND ((length(TRIM(BOTH FROM item_type)) >= 1) AND (length(TRIM(BOTH FROM item_type)) <= 100))));

create table if not exists public.pedidos (id uuid primary key default gen_random_uuid(), criado_em timestamptz not null default now(), retirada text not null check (char_length(retirada) between 3 and 200), entrega text not null check (char_length(entrega) between 3 and 200), item text not null check (char_length(item) <= 60), distancia_km integer not null check (distancia_km in (3,5,8,12)), preco numeric not null, status text not null default 'procurando' check (status in ('procurando','aceito','coletado','entregue','cancelado')), motoboy_nome text, codigo text not null default lpad(floor(random()*10000)::int::text,4,'0'), entregue_em timestamptz);
alter table public.pedidos enable row level security;

CREATE OR REPLACE FUNCTION public.criar_pedido(p_retirada text, p_entrega text, p_item text, p_km integer)
 RETURNS TABLE(pedido_id uuid, valor numeric, cod text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_km not in (3, 5, 8, 12) then raise exception 'Distância inválida'; end if;
  return query
    insert into public.pedidos (retirada, entrega, item, distancia_km, preco)
    values (trim(p_retirada), trim(p_entrega), left(p_item, 60), p_km, 6 + p_km)
    returning pedidos.id, pedidos.preco, pedidos.codigo;
end $function$;

CREATE OR REPLACE FUNCTION public.pedidos_abertos()
 RETURNS TABLE(id uuid, retirada text, entrega text, item text, preco numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.retirada, p.entrega, p.item, p.preco
  from public.pedidos p
  where p.status = 'procurando'
  order by p.criado_em
  limit 20;
$function$;

CREATE OR REPLACE FUNCTION public.aceitar_pedido(p_id uuid, p_motoboy text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.pedidos
     set status = 'aceito', motoboy_nome = left(trim(p_motoboy), 60)
   where id = p_id and status = 'procurando';
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.status_pedido(p_id uuid)
 RETURNS TABLE(status text, motoboy_nome text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.status, p.motoboy_nome from public.pedidos p where p.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_pedido(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.pedidos set status = 'cancelado'
   where id = p_id and status in ('procurando', 'aceito');
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.minha_corrida(p_motoboy text)
 RETURNS TABLE(id uuid, retirada text, entrega text, item text, preco numeric, status text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                          select p.id, p.retirada, p.entrega, p.item, p.preco, p.status
                                            from public.pedidos p
                                              where p.motoboy_nome = left(trim(p_motoboy), 60) and p.status in ('aceito', 'coletado')
                                                order by p.criado_em desc
                                                  limit 1;
                                                  $function$;

CREATE OR REPLACE FUNCTION public.avancar_pedido(p_id uuid, p_motoboy text, p_codigo text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  declare v public.pedidos;
  begin
    select * into v from public.pedidos
       where id = p_id and motoboy_nome = left(trim(p_motoboy), 60)
          for update;
            if not found then return 'nao_encontrado'; end if;
              if v.status = 'aceito' then
                  update public.pedidos set status = 'coletado' where id = p_id;
                      return 'coletado';
                        elsif v.status = 'coletado' then
                            if coalesce(p_codigo, '') <> v.codigo then return 'codigo_errado'; end if;
                                update public.pedidos set status = 'entregue', entregue_em = now() where id = p_id;
                                    return 'entregue';
                                      end if;
                                        return v.status;
                                        end $function$;

CREATE OR REPLACE FUNCTION public.ganhos(p_motoboy text)
 RETURNS TABLE(id uuid, retirada text, entrega text, preco numeric, entregue_em timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                    select p.id, p.retirada, p.entrega, p.preco, p.entregue_em
                                                      from public.pedidos p
                                                        where p.motoboy_nome = left(trim(p_motoboy), 60) and p.status = 'entregue'
                                                          order by p.entregue_em desc
                                                            limit 50;
                                                            $function$;
