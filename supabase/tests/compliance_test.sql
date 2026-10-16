-- Testes de compliance (transação desfeita no final)
begin;
create temp table r(teste text, ok boolean, detalhe text); grant all on r to authenticated, anon;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c1@t.local','{"role":"cliente","aceite_termos":"true","user_agent":"teste"}'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c2@t.local','{"role":"cliente"}'),
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m1@t.local','{"role":"motoboy"}'),
 ('00000000-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ad@t.local','{"role":"cliente"}');
update profiles set role='admin' where id='00000000-0000-0000-0000-0000000000ad';
insert into r select 'aceite gravado no cadastro (checkbox)', count(*)=2, string_agg(doc||' v'||versao, ', ') from aceites_termos where user_id='00000000-0000-0000-0000-0000000000c1';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',true);
insert into r select 'quem aceitou não tem pendência', count(*)=0, '' from aceites_pendentes();
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}',true);
insert into r select 'sem aceite: 2 pendentes', count(*)=2, string_agg(doc, ',') from aceites_pendentes();
insert into r select 'registrar_aceites', registrar_aceites(array['termos_cliente','privacidade'], 'UA teste', '1.2')=2, '';
insert into r select 'pendências zeradas', count(*)=0, '' from aceites_pendentes();
reset role;
insert into documentos_legais (doc, versao, url, vigente_desde) values ('privacidade','1.1','https://x', now() + interval '1 second');
set local role authenticated;
-- (vigente_desde no futuro próximo não conta como vigente ainda; usamos now() para simular mudança)
reset role; update documentos_legais set vigente_desde = now() + interval '1 hour' where versao='1.0' and doc='privacidade' and false;
update documentos_legais set vigente_desde = '2099-01-01' where doc='privacidade' and versao='1.1';
set local role authenticated;
insert into r select 'nova versão gera novo pedido de aceite', count(*)=1, string_agg(doc||' '||versao, ',') from aceites_pendentes();

-- motofrete
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
do $$ begin perform enviar_cadastro_motoboy('M','53','52998224725','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '20 years')::date, 'A', (current_date - interval '3 years')::date, current_date + 100, '00000000-0000-0000-0000-0000000000a1/c');
  insert into r values ('recusa menor de 21', false, 'aceitou'); exception when others then insert into r values ('recusa menor de 21', sqlerrm like '%21 anos%', sqlerrm); end $$;
do $$ begin perform enviar_cadastro_motoboy('M','53','52998224725','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '30 years')::date, 'A', (current_date - interval '1 years')::date, current_date + 100, '00000000-0000-0000-0000-0000000000a1/c');
  insert into r values ('recusa CNH A < 2 anos', false, 'aceitou'); exception when others then insert into r values ('recusa CNH A < 2 anos', sqlerrm like '%2 anos%', sqlerrm); end $$;
do $$ begin perform enviar_cadastro_motoboy('M','53','52998224725','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '30 years')::date, 'B', (current_date - interval '5 years')::date, current_date + 100, '00000000-0000-0000-0000-0000000000a1/c');
  insert into r values ('recusa sem categoria A', false, 'aceitou'); exception when others then insert into r values ('recusa sem categoria A', sqlerrm like '%categoria A%', sqlerrm); end $$;
do $$ begin perform enviar_cadastro_motoboy('M','53','11111111111','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '30 years')::date, 'A', (current_date - interval '5 years')::date, current_date + 100, '00000000-0000-0000-0000-0000000000a1/c');
  insert into r values ('recusa CPF inválido', false, 'aceitou'); exception when others then insert into r values ('recusa CPF inválido', sqlerrm like '%CPF%', sqlerrm); end $$;
do $$ begin perform enviar_cadastro_motoboy('M','53','52998224725','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '30 years')::date, 'A', (current_date - interval '5 years')::date, current_date + 100, null);
  insert into r values ('exige certificado do curso', false, 'aceitou'); exception when others then insert into r values ('exige certificado do curso', sqlerrm like '%curso%', sqlerrm); end $$;
do $$ begin perform enviar_cadastro_motoboy('M','53','52998224725','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '30 years')::date, 'A', (current_date - interval '5 years')::date, current_date + 100, '00000000-0000-0000-0000-0000000000a1/c', '00000000-0000-0000-0000-0000000000a1/ant', false);
  insert into r values ('antecedentes exige consentimento', false, 'aceitou'); exception when others then insert into r values ('antecedentes exige consentimento', sqlerrm like '%consentir%', sqlerrm); end $$;
insert into r select 'cadastro válido aceito', enviar_cadastro_motoboy('M','53','529.982.247-25','1','ABC1D23','CG','00000000-0000-0000-0000-0000000000a1/f','00000000-0000-0000-0000-0000000000a1/d', (current_date - interval '30 years')::date, 'AB', (current_date - interval '5 years')::date, current_date + 100, '00000000-0000-0000-0000-0000000000a1/c', '00000000-0000-0000-0000-0000000000a1/ant', true) = 'pendente', '';
do $$ begin perform contestar_status('quero contestar isso'); insert into r values ('pendente não contesta', false, ''); exception when others then insert into r values ('pendente não contesta', true, sqlerrm); end $$;

-- suspensão com motivo
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}',true);
do $$ begin perform definir_status_motoboy('00000000-0000-0000-0000-0000000000a1','bloqueado',''); insert into r values ('bloqueio exige motivo', false, ''); exception when others then insert into r values ('bloqueio exige motivo', true, sqlerrm); end $$;
select definir_status_motoboy('00000000-0000-0000-0000-0000000000a1','bloqueado','Documento ilegível');
insert into r select 'histórico registrado', count(*)=1, max(motivo) from admin_historico('00000000-0000-0000-0000-0000000000a1');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
insert into r select 'motoboy vê o motivo', motivo = 'Documento ilegível', motivo from minha_situacao();
insert into r select 'motoboy contesta', contestar_status('Enviei outro documento legível hoje') > 0, '';
do $$ begin perform definir_status_motoboy('00000000-0000-0000-0000-0000000000a1','aprovado','me aprovando'); insert into r values ('motoboy não muda o próprio status', false, ''); exception when others then insert into r values ('motoboy não muda o próprio status', true, sqlerrm); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}',true);
insert into r select 'cliente não vê contestações', count(*)=0, '' from contestacoes;
do $$ begin perform admin_contestacoes(); insert into r values ('cliente não lista contestações (admin)', false, ''); exception when others then insert into r values ('cliente não lista contestações (admin)', true, sqlerrm); end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}',true);
select responder_contestacao((select id from contestacoes limit 1), 'deferida', 'Documento conferido, ok');
insert into r select 'contestação deferida reaprova', status='aprovado', status from motoboys where id='00000000-0000-0000-0000-0000000000a1';

-- exclusão
do $$ begin perform excluir_dados_usuario('00000000-0000-0000-0000-0000000000c2'); insert into r values ('usuário comum não chama exclusão direta', false, ''); exception when others then insert into r values ('usuário comum não chama exclusão direta', true, sqlerrm); end $$;
reset role;
insert into pedidos (cliente_id, retirada, entrega, ret_lat, ret_lng, ent_lat, ent_lng, item, distancia_km, preco, status)
values ('00000000-0000-0000-0000-0000000000c2','Rua A 123','Rua B 456',-31.771234,-52.341234,-31.761234,-52.331234,'x',2,8,'entregue');
select excluir_dados_usuario('00000000-0000-0000-0000-0000000000c2');
delete from auth.users where id='00000000-0000-0000-0000-0000000000c2';
insert into r select 'pedido anonimizado e mantido', count(*)=1 and bool_and(cliente_id is null and retirada like '%removido%' and ret_lat = -31.77), max(retirada) from pedidos where preco=8 and item='x';
insert into r select 'perfil apagado', count(*)=0, '' from profiles where id='00000000-0000-0000-0000-0000000000c2';
insert into r select 'registro de exclusão', count(*)>=1, '' from solicitacoes_exclusao where user_hash = encode(extensions.digest('00000000-0000-0000-0000-0000000000c2','sha256'),'hex');
insert into r select 'cron agendado', count(*)=2, string_agg(jobname, ',') from cron.job where jobname like 'eja_%';
select json_agg(r) resultado from r;
rollback;
