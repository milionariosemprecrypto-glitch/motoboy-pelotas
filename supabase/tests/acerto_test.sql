-- Acerto: dinheiro vira débito de 20%; PIX simulado vira repasse de 80%.
begin;
create temp table r(teste text, ok boolean, detalhe text);
grant all on r to anon, authenticated;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b1@teste.local','{"role":"cliente","nome":"Cliente Acerto"}'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b2@teste.local','{"role":"motoboy","nome":"Moto Acerto"}');
update motoboys set status = 'aprovado', cpf = '39053344705' where id = '00000000-0000-0000-0000-0000000000b2';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

insert into r select 'cria corrida em dinheiro', forma_pagamento = 'dinheiro' and valor_plataforma = round(preco * 0.20, 2),
  coalesce(valor_plataforma::text,'')
from (
  select c.pedido_id as id from criar_pedido('Rua A','Rua B','Documento',-31.7719,-52.3426,-31.7600,-52.3300, null, '10', null, '20', null, 'dinheiro') c
) x join pedidos p on p.id = x.id;

insert into r select 'dinheiro não cobra online', modo = 'especie' and status = 'pago', coalesce(mensagem,'')
from iniciar_cobranca((select id from pedidos where cliente_id = '00000000-0000-0000-0000-0000000000b1' and forma_pagamento = 'dinheiro'));

reset role;
update pedidos set motoboy_id = '00000000-0000-0000-0000-0000000000b2', status = 'entregue', entregue_em = now()
where cliente_id = '00000000-0000-0000-0000-0000000000b1' and forma_pagamento = 'dinheiro';

insert into r select 'dinheiro gera débito de 20%',
  valor = -p.valor_plataforma and tipo = 'taxa_dinheiro', coalesce(l.valor::text,'')
from ledger_motoboy l join pedidos p on p.id = l.pedido_id
where p.forma_pagamento = 'dinheiro' and p.motoboy_id = '00000000-0000-0000-0000-0000000000b2';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
insert into r select 'cria corrida no cartão', forma_pagamento = 'cartao', coalesce(forma_pagamento,'')
from (
  select c.pedido_id as id from criar_pedido('Rua C','Rua D','Documento',-31.7719,-52.3426,-31.7550,-52.3400, null, '11', null, '21', null, 'cartao') c
) x join pedidos p on p.id = x.id;
insert into r select 'cartão sem chave fica simulado', modo = 'simulado' and status = 'simulado', coalesce(mensagem,'')
from iniciar_cobranca((select id from pedidos where cliente_id = '00000000-0000-0000-0000-0000000000b1' and forma_pagamento = 'cartao'));

reset role;
update pedidos set motoboy_id = '00000000-0000-0000-0000-0000000000b2', status = 'entregue', entregue_em = now()
where cliente_id = '00000000-0000-0000-0000-0000000000b1' and forma_pagamento = 'cartao';

insert into r select 'cartão simulado gera repasse de 80%',
  l.valor = p.valor_motoboy and l.valor = p.preco - p.valor_plataforma, l.valor::text
from ledger_motoboy l join pedidos p on p.id = l.pedido_id
where p.forma_pagamento = 'cartao';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

insert into r select 'saldo desconta o dinheiro do repasse',
  saldo = (select sum(valor) from ledger_motoboy where motoboy_id = auth.uid()),
  saldo::text
from meu_saldo();
insert into r select 'sem chave ainda não está pronto', pronto = false, coalesce(pronto::text,'')
from salvar_recebimento('cpf', '123', 'João', '39053344705', null, null, null, null);
insert into r select 'com chave PIX fica pronto', pronto = true, coalesce(mensagem,'')
from salvar_recebimento('cpf', '39053344705', 'João da Silva', '39053344705', null, null, null, null);

select json_agg(r order by teste) as resultado from r;
rollback;
