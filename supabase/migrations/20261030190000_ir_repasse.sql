-- No informe, corrida em dinheiro não conta como repasse da plataforma:
-- o motoboy já recebeu o total em espécie. A taxa continua na coluna de retenção.

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
revoke execute on function public.meu_ir(int, int) from public, anon;
grant execute on function public.meu_ir(int, int) to authenticated;
