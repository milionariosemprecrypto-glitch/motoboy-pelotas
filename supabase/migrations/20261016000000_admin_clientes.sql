-- Admin: lista de clientes + Julio como admin
create or replace function public.admin_clientes()
returns table(id uuid, nome text, telefone text, email text, role text, criado_em timestamptz, pedidos bigint, ultimo_pedido timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select p.id, p.nome, p.telefone, u.email::text, p.role, p.criado_em,
    (select count(*) from pedidos x where x.cliente_id = p.id), (select max(x.criado_em) from pedidos x where x.cliente_id = p.id)
    from profiles p join auth.users u on u.id = p.id where p.role in ('cliente','admin') order by p.criado_em desc;
end $$;
revoke execute on function public.admin_clientes() from public, anon;
grant execute on function public.admin_clientes() to authenticated;
update public.profiles set role = 'admin' where id = '91ee58e3-0808-4bba-ac4b-424ace16048f';
