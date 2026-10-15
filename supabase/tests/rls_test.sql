-- Testes de RLS (rodam dentro de uma transação e desfazem tudo no final).
begin;
create temp table r(teste text, ok boolean, detalhe text);
grant all on r to anon, authenticated;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c1@teste.local','{"role":"cliente","nome":"Cliente 1"}'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c2@teste.local','{"role":"cliente","nome":"Cliente 2"}'),
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m1@teste.local','{"role":"motoboy","nome":"Moto Pendente"}'),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2@teste.local','{"role":"admin","nome":"Tentou ser admin"}');
-- a2 tentou virar admin pelo cadastro: deve ter virado cliente
insert into r select 'cadastro não vira admin', role='cliente', role from profiles where id='00000000-0000-0000-0000-0000000000a2';
-- motoboy aprovado (como o admin faria no dashboard)
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m3@teste.local','{"role":"motoboy","nome":"Moto OK"}');
update motoboys set status='aprovado' where id='00000000-0000-0000-0000-0000000000a3';

-- cliente 1 cria pedido
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
insert into r select 'cliente cria pedido (preço servidor)', valor >= 8, 'R$ '||valor||' / '||km||' km' from criar_pedido('Rua A 100','Rua B 200','Documento',-31.7719,-52.3426,-31.7600,-52.3300);
insert into r select 'cliente vê o próprio pedido', count(*)=1, count(*)::text from pedidos;
do $$ begin perform 1; insert into pedidos(cliente_id,retirada,entrega,ret_lat,ret_lng,ent_lat,ent_lng,item,distancia_km,preco) values (auth.uid(),'xxx','yyy',0,0,0,0,'x',1,0.01);
  insert into r values ('cliente não insere direto', false, 'inseriu!'); exception when others then insert into r values ('cliente não insere direto', true, sqlerrm); end $$;
do $$ begin update profiles set role='admin' where id=auth.uid(); insert into r values ('cliente não muda role', false, 'mudou!'); exception when others then insert into r values ('cliente não muda role', true, sqlerrm); end $$;

-- cliente 2 não vê pedido do cliente 1
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}',true);
insert into r select 'cliente 2 não vê pedido alheio', count(*)=0, count(*)::text from pedidos;
insert into r select 'cliente 2 não vê código alheio', count(*)=0, count(*)::text from pedido_codigos;
insert into r select 'cliente 2 não cancela pedido alheio', not cancelar_pedido((select id from pedidos limit 1)), '';

-- motoboy pendente
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
do $$ begin perform pedidos_abertos(); insert into r values ('pendente não lista pedidos', false, 'listou!'); exception when others then insert into r values ('pendente não lista pedidos', true, sqlerrm); end $$;
reset role;
create temp table pid as select id from pedidos where cliente_id='00000000-0000-0000-0000-0000000000c1';
grant select on pid to authenticated;
set local role authenticated;
do $$ begin perform aceitar_pedido((select id from pid)); insert into r values ('pendente não aceita', false, 'aceitou!'); exception when others then insert into r values ('pendente não aceita', true, sqlerrm); end $$;

-- motoboy aprovado aceita, vê pedido mas não o código
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}',true);
insert into r select 'aprovado lista pedidos', count(*)=1, count(*)::text from pedidos_abertos();
insert into r select 'aprovado aceita', aceitar_pedido((select id from pid)), '';
insert into r select 'motoboy não vê código', count(*)=0, '' from pedido_codigos;
insert into r select 'coletar', avancar_pedido((select id from pid))='coletado', '';
insert into r select 'código errado recusado', avancar_pedido((select id from pid),'xxxx')='codigo_errado', '';

-- anon
reset role; set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin perform count(*) from pedidos; insert into r values ('anon não lê pedidos', false, 'leu!'); exception when others then insert into r values ('anon não lê pedidos', true, sqlerrm); end $$;
do $$ begin perform criar_pedido('aaa','bbb','x',0,0,0,0); insert into r values ('anon não chama RPC', false, 'chamou!'); exception when others then insert into r values ('anon não chama RPC', true, sqlerrm); end $$;
do $$ begin perform count(*) from profiles; insert into r values ('anon não lê profiles', false, 'leu!'); exception when others then insert into r values ('anon não lê profiles', true, sqlerrm); end $$;
reset role;
select json_agg(r) as resultado from r;
rollback;
