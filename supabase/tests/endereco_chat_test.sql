-- Número da casa + chat da corrida + retenção. Roda no SQL Editor e desfaz no final.
begin;
create temp table r(teste text, ok boolean, detalhe text);
grant all on r to anon, authenticated;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1@teste.local','{"role":"cliente","nome":"Cliente Chat"}'),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e2@teste.local','{"role":"cliente","nome":"Outro"}'),
 ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e3@teste.local','{"role":"motoboy","nome":"Moto Chat"}'),
 ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e4@teste.local','{"role":"motoboy","nome":"Moto Alheio"}');
update motoboys set status = 'aprovado' where id in ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000e4');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

do $$ begin perform criar_pedido('Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300);
  insert into r values ('sem número é recusado', false, 'aceitou');
exception when others then insert into r values ('sem número é recusado', sqlerrm ilike '%número%', sqlerrm); end $$;
do $$ begin perform criar_pedido('Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300, null, '!!', null, '1', null);
  insert into r values ('número inválido é recusado', false, 'aceitou');
exception when others then insert into r values ('número inválido é recusado', sqlerrm ilike '%inválido%', sqlerrm); end $$;
do $$ begin perform criar_pedido('Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300, null, '10', null, '20', null);
  insert into r values ('sem pagamento é recusado', false, 'aceitou');
exception when others then insert into r values ('sem pagamento é recusado', sqlerrm ilike '%pagar%', sqlerrm); end $$;
do $$ begin perform criar_pedido('Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300, null, '10', null, '20', null, 'boleto');
  insert into r values ('pagamento inválido é recusado', false, 'aceitou');
exception when others then insert into r values ('pagamento inválido é recusado', sqlerrm ilike '%pagar%', sqlerrm); end $$;
do $$
declare v_id uuid;
begin
  select c.pedido_id into v_id from criar_pedido(
    'Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300, null, '10', null, '20', null, 'cartao') c;
  if not cancelar_pedido(v_id) then
    insert into r values ('cartão volta a ser aceito no pedido', false, 'não cancelou');
  else
    insert into r values ('cartão volta a ser aceito no pedido', true, 'ok');
  end if;
exception when others then insert into r values ('cartão volta a ser aceito no pedido', false, sqlerrm); end $$;

-- criar_pedido devolve pedido_id/valor/km/cod; o número fica na linha de pedidos.
do $$
declare v_id uuid;
begin
  select c.pedido_id into v_id from criar_pedido(
    'Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300,
    null, 's/n', 'portão azul', '120A', '   ', 'PIX') c;
  insert into r select 'grava S/N, complemento e número',
    ret_numero = 'S/N' and ret_complemento = 'portão azul' and ent_numero = '120A' and ent_complemento is null
      and forma_pagamento = 'pix',
    coalesce(ret_numero,'') || '/' || coalesce(ent_numero,'') || '/' || coalesce(forma_pagamento,'')
  from pedidos where id = v_id;
end $$;

create temp table pid as select id from pedidos where cliente_id = '00000000-0000-0000-0000-0000000000e1' and status = 'procurando';
grant select on pid to authenticated;

do $$ begin
  insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'ainda não' from pid;
  insert into r values ('chat fechado antes do aceite', false, 'inseriu');
exception when others then insert into r values ('chat fechado antes do aceite', true, sqlerrm); end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
insert into r select 'motoboy vê o número na oferta', ret_numero = 'S/N' and ent_numero = '120A' and forma_pagamento = 'pix', coalesce(forma_pagamento,'') from pedidos_abertos() where id = (select id from pid);
insert into r select 'motoboy aceita', aceitar_pedido((select id from pid)), '';
insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'Estou na porta' from pid;
insert into r select 'motoboy envia mensagem', count(*) = 1, count(*)::text from mensagens;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}', true);
insert into r select 'outro motoboy não lê o chat', count(*) = 0, count(*)::text from mensagens;
do $$ begin
  insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'invasão' from pid;
  insert into r values ('outro motoboy não envia', false, 'inseriu');
exception when others then insert into r values ('outro motoboy não envia', true, sqlerrm); end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
insert into r select 'outro cliente não lê o chat', count(*) = 0, count(*)::text from mensagens;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
insert into r select 'cliente lê a mensagem', count(*) = 1, count(*)::text from mensagens;
insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'Pode subir' from pid;
update mensagens set lida_em = now() where autor_id = auth.uid();
insert into r select 'autor não marca a própria como lida', count(*) = 0, count(*)::text
from mensagens where autor_id = auth.uid() and lida_em is not null;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
update mensagens set lida_em = now() where autor_id = '00000000-0000-0000-0000-0000000000e1';
insert into r select 'motoboy marca a do cliente como lida', count(*) = 1, count(*)::text from mensagens where autor_id = '00000000-0000-0000-0000-0000000000e1' and lida_em is not null;
do $$ begin
  update mensagens set texto = 'trocada' where autor_id = '00000000-0000-0000-0000-0000000000e1';
  insert into r values ('não altera o texto', false, 'alterou');
exception when others then insert into r values ('não altera o texto', sqlerrm ilike '%lida%' or sqlerrm ilike '%permission denied%', sqlerrm); end $$;

do $$
declare i int;
begin
  -- Já existe "Estou na porta" deste motoboy; mais 19 chegam no limite de 20.
  for i in 1..19 loop
    insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'extra ' || i from pid;
  end loop;
  insert into r values ('até 20 mensagens por minuto', (select count(*) from mensagens where autor_id = auth.uid()) = 20, '');
exception when others then insert into r values ('até 20 mensagens por minuto', false, sqlerrm); end $$;
do $$ begin
  insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'demais' from pid;
  insert into r values ('21ª mensagem bloqueada', false, 'passou');
exception when others then insert into r values ('21ª mensagem bloqueada', sqlerrm ilike '%Muitas mensagens%', sqlerrm); end $$;

insert into r select 'minha corrida traz o número', ret_numero = 'S/N' and ent_complemento is null and ent_numero = '120A' and forma_pagamento = 'pix', coalesce(forma_pagamento,'') from minha_corrida();
insert into r select 'coleta', avancar_pedido((select id from pid)) = 'coletado', '';

reset role;
create temp table cod as select pedido_id, codigo from pedido_codigos where pedido_id = (select id from pid);
grant select on cod to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
insert into r select 'entrega', avancar_pedido((select id from pid), (select codigo from cod)) = 'entregue', '';
insert into r select 'chat some depois de entregue', count(*) = 0, count(*)::text from mensagens;
do $$ begin
  insert into mensagens (pedido_id, autor_id, texto) select id, auth.uid(), 'tarde' from pid;
  insert into r values ('não envia depois de entregue', false, 'inseriu');
exception when others then insert into r values ('não envia depois de entregue', true, sqlerrm); end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
insert into r select 'cliente também não lê depois', count(*) = 0, count(*)::text from mensagens;

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}', true);
do $$ begin perform count(*) from mensagens; insert into r values ('anon não lê mensagens', false, 'leu');
exception when others then insert into r values ('anon não lê mensagens', true, sqlerrm); end $$;

reset role;
do $$
declare v_id uuid;
begin
  alter table public.pedidos drop constraint pedidos_forma_pagamento_check;
  insert into pedidos (cliente_id, retirada, entrega, ret_lat, ret_lng, ent_lat, ent_lng, item, distancia_km, preco, status, entregue_em, forma_pagamento)
  values ('00000000-0000-0000-0000-0000000000e2','Rua Cartão','Rua Cartão 2',-31.77,-52.34,-31.76,-52.33,'cartao-antigo',1,8,'entregue', now(), 'cartao')
  returning id into v_id;
  alter table public.pedidos add constraint pedidos_forma_pagamento_check
    check (forma_pagamento in ('pix', 'dinheiro')) not valid;
  insert into r select 'pedido antigo com cartão continua legível', forma_pagamento = 'cartao', coalesce(forma_pagamento,'')
    from pedidos where id = v_id;
  alter table public.pedidos drop constraint pedidos_forma_pagamento_check;
  alter table public.pedidos add constraint pedidos_forma_pagamento_check
    check (forma_pagamento is null or forma_pagamento in ('pix', 'dinheiro', 'cartao'));
end $$;
do $$ begin
  insert into pedidos (cliente_id, retirada, entrega, ret_lat, ret_lng, ent_lat, ent_lng, item, distancia_km, preco, status, entregue_em, forma_pagamento)
  values ('00000000-0000-0000-0000-0000000000e2','Rua Nova Cartão','Rua do Cartão',-31.77,-52.34,-31.76,-52.33,'cartao-novo',1,8,'entregue', now(), 'cartao');
  insert into r values ('cartão volta a ser aceito', true, 'ok');
exception when others then insert into r values ('cartão volta a ser aceito', false, sqlerrm); end $$;
insert into pedidos (cliente_id, retirada, entrega, ret_lat, ret_lng, ent_lat, ent_lng, item, distancia_km, preco, status, entregue_em, ret_numero, ent_numero)
values ('00000000-0000-0000-0000-0000000000e2','Rua Velha','Rua Velha 2',-31.77,-52.34,-31.76,-52.33,'velho',1,8,'entregue', now() - interval '91 days', '9', '8');
insert into mensagens (pedido_id, autor_id, texto)
select id, '00000000-0000-0000-0000-0000000000e2', 'mensagem antiga da corrida' from pedidos where item = 'velho';
insert into pedidos (cliente_id, retirada, entrega, ret_lat, ret_lng, ent_lat, ent_lng, item, distancia_km, preco, status, entregue_em, ret_numero)
values ('00000000-0000-0000-0000-0000000000e2','Rua Nova','Rua Nova 2',-31.77,-52.34,-31.76,-52.33,'novo',1,8,'entregue', now(), '15');
insert into mensagens (pedido_id, autor_id, texto, criado_em)
select id, '00000000-0000-0000-0000-0000000000e2', 'mensagem de 91 dias', now() - interval '91 days' from pedidos where item = 'novo';
insert into mensagens (pedido_id, autor_id, texto)
select id, '00000000-0000-0000-0000-0000000000e2', 'mensagem recente' from pedidos where item = 'novo';
select privado.limpar_gps();
insert into r select 'retenção apaga chat de corrida encerrada há 90 dias',
  not exists (select 1 from mensagens m join pedidos p on p.id = m.pedido_id where p.item = 'velho'), '';
insert into r select 'retenção apaga mensagem com mais de 90 dias',
  not exists (select 1 from mensagens where texto = 'mensagem de 91 dias'), '';
insert into r select 'mensagem recente de corrida nova permanece',
  exists (select 1 from mensagens where texto = 'mensagem recente'), '';
select excluir_dados_usuario('00000000-0000-0000-0000-0000000000e2');
insert into r select 'exclusão apaga número e texto do chat',
  bool_and(ret_numero is null and ent_numero is null) and not exists (select 1 from mensagens m join pedidos p on p.id = m.pedido_id where p.cliente_id = '00000000-0000-0000-0000-0000000000e2' and m.texto <> 'Mensagem removida (LGPD)'),
  '' from pedidos where cliente_id = '00000000-0000-0000-0000-0000000000e2';

select json_agg(r order by teste) as resultado from r;
rollback;
