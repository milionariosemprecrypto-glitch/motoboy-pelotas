-- É-Já — Compliance (LGPD, Play Store, devido processo, motofrete). Ver /workspace/eja-juridico/respostas.md

-- ===== 1. Documentos legais versionados + aceites =====
create table if not exists public.documentos_legais (
  doc text not null check (doc in ('termos_cliente','termos_motoboy','privacidade')),
  versao text not null,
  url text not null,
  vigente_desde timestamptz not null default now(),
  primary key (doc, versao)
);
insert into public.documentos_legais (doc, versao, url) values
  ('termos_cliente', '1.0', 'https://eja-site.pages.dev/termos/'),
  ('termos_motoboy', '1.0', 'https://eja-site.pages.dev/termos-motoboy/'),
  ('privacidade',    '1.0', 'https://eja-site.pages.dev/privacidade/')
on conflict do nothing;
alter table public.documentos_legais enable row level security;
create policy "docs legais: leitura pública" on public.documentos_legais for select to anon, authenticated using (true);
grant select on public.documentos_legais to anon, authenticated;

create or replace view public.documentos_vigentes with (security_invoker = true) as
  select distinct on (doc) doc, versao, url, vigente_desde from public.documentos_legais order by doc, vigente_desde desc;
grant select on public.documentos_vigentes to anon, authenticated;

create table if not exists public.aceites_termos (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,   -- prova mantida mesmo após exclusão (sem vínculo ao titular)
  doc text not null, versao text not null,
  aceito_em timestamptz not null default now(),
  ip text, user_agent text, app_versao text, origem text not null default 'app'
);
create index if not exists aceites_user on public.aceites_termos (user_id, doc, versao);
alter table public.aceites_termos enable row level security;
create policy "aceites: ver os próprios" on public.aceites_termos for select to authenticated using (user_id = auth.uid());
create policy "aceites: admin" on public.aceites_termos for select to authenticated using (public.is_admin());
revoke all on public.aceites_termos from anon, authenticated;
grant select on public.aceites_termos to authenticated;

create or replace function public.docs_do_papel(p_role text) returns text[]
language sql immutable as $$
  select case when p_role = 'motoboy' then array['termos_motoboy','privacidade'] else array['termos_cliente','privacidade'] end
$$;

-- IP do cliente a partir dos cabeçalhos repassados pelo PostgREST (Cloudflare/Supabase)
create or replace function public.ip_requisicao() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1))
$$;

-- Documentos que o usuário ainda precisa aceitar (versão vigente)
create or replace function public.aceites_pendentes()
returns table(doc text, versao text, url text)
language sql stable security definer set search_path = public as $$
  select d.doc, d.versao, d.url from documentos_vigentes d
  where d.doc = any(docs_do_papel((select role from profiles where id = auth.uid())))
    and not exists (select 1 from aceites_termos a where a.user_id = auth.uid() and a.doc = d.doc and a.versao = d.versao)
$$;

-- Registra o aceite (clique) das versões vigentes; grava IP e user-agent do servidor
create or replace function public.registrar_aceites(p_docs text[], p_user_agent text default null, p_app_versao text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; d record;
begin
  if auth.uid() is null then raise exception 'Faça login'; end if;
  for d in select * from documentos_vigentes where doc = any(p_docs) loop
    insert into aceites_termos (user_id, doc, versao, ip, user_agent, app_versao)
    values (auth.uid(), d.doc, d.versao, ip_requisicao(),
            left(coalesce(p_user_agent, nullif(current_setting('request.headers', true), '')::json->>'user-agent'), 400), left(p_app_versao, 30));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== 2. Motoboy: campos de motofrete (Lei 12.009/2009) + status com motivo =====
alter table public.motoboys
  add column if not exists nascimento date,
  add column if not exists cnh_categoria text check (char_length(cnh_categoria) <= 5),
  add column if not exists cnh_primeira_hab date,
  add column if not exists cnh_validade date,
  add column if not exists curso_path text,
  add column if not exists antecedentes_path text,
  add column if not exists antecedentes_consentimento_em timestamptz,
  add column if not exists status_motivo text,
  add column if not exists status_em timestamptz;
alter table public.motoboys drop constraint if exists motoboys_status_check;
alter table public.motoboys add constraint motoboys_status_check check (status in ('pendente','aprovado','bloqueado','reprovado'));

create or replace function public.cpf_valido(p text) returns boolean language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p,''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  for k in 0..1 loop
    s := 0;
    for i in 1..9+k loop s := s + substr(d, i, 1)::int * (11 + k - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, 10 + k, 1)::int then return false; end if;
  end loop;
  return true;
end $$;

drop function if exists public.enviar_cadastro_motoboy(text,text,text,text,text,text,text,text);
create or replace function public.enviar_cadastro_motoboy(
  p_nome text, p_telefone text, p_cpf text, p_cnh text, p_placa text, p_modelo text,
  p_foto_path text, p_doc_path text,
  p_nascimento date, p_cnh_categoria text, p_cnh_primeira_hab date, p_cnh_validade date,
  p_curso_path text, p_antecedentes_path text default null, p_consentimento_antecedentes boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; u text := auth.uid()::text || '/';
begin
  select status into v_status from motoboys where id = auth.uid();
  if v_status is null then raise exception 'Conta não é de motoboy'; end if;
  if v_status = 'bloqueado' then raise exception 'Cadastro bloqueado'; end if;
  if not cpf_valido(p_cpf) then raise exception 'CPF inválido'; end if;
  if p_nascimento is null or p_nascimento > (current_date - interval '21 years') then
    raise exception 'É preciso ter 21 anos ou mais (Lei 12.009/2009)'; end if;
  if upper(coalesce(p_cnh_categoria,'')) !~ 'A' then raise exception 'A CNH precisa ter categoria A'; end if;
  if p_cnh_primeira_hab is null or p_cnh_primeira_hab > (current_date - interval '2 years') then
    raise exception 'É preciso ter CNH categoria A há pelo menos 2 anos (Lei 12.009/2009)'; end if;
  if p_cnh_validade is null or p_cnh_validade < current_date then raise exception 'CNH vencida'; end if;
  if p_curso_path is null then raise exception 'Envie o certificado do curso de motofrete'; end if;
  if p_foto_path not like u || '%' or p_doc_path not like u || '%' or p_curso_path not like u || '%'
     or (p_antecedentes_path is not null and p_antecedentes_path not like u || '%') then raise exception 'Arquivos inválidos'; end if;
  if p_antecedentes_path is not null and not coalesce(p_consentimento_antecedentes, false) then
    raise exception 'Para enviar certidão de antecedentes é preciso consentir'; end if;
  update profiles set nome = left(trim(p_nome),80), telefone = left(trim(p_telefone),20) where id = auth.uid();
  update motoboys set cpf = regexp_replace(p_cpf,'\D','','g'), cnh = trim(p_cnh), placa = upper(trim(p_placa)),
         modelo = trim(p_modelo), foto_path = p_foto_path, doc_path = p_doc_path, enviado_em = now(),
         nascimento = p_nascimento, cnh_categoria = upper(trim(p_cnh_categoria)), cnh_primeira_hab = p_cnh_primeira_hab,
         cnh_validade = p_cnh_validade, curso_path = p_curso_path, antecedentes_path = p_antecedentes_path,
         antecedentes_consentimento_em = case when p_antecedentes_path is not null then now() end,
         status = case when status = 'reprovado' then 'pendente' else status end
   where id = auth.uid();
  return v_status;
end $$;

-- ===== 3. Devido processo: histórico + contestação =====
create table if not exists public.motoboy_status_historico (
  id bigint generated always as identity primary key,
  motoboy_id uuid references public.motoboys(id) on delete cascade,
  de text, para text not null, motivo text not null,
  admin_id uuid references auth.users(id) on delete set null,
  em timestamptz not null default now()
);
alter table public.motoboy_status_historico enable row level security;
create policy "historico: motoboy vê o seu" on public.motoboy_status_historico for select to authenticated using (motoboy_id = auth.uid());
create policy "historico: admin" on public.motoboy_status_historico for select to authenticated using (public.is_admin());
revoke all on public.motoboy_status_historico from anon, authenticated;
grant select on public.motoboy_status_historico to authenticated;

create table if not exists public.contestacoes (
  id bigint generated always as identity primary key,
  motoboy_id uuid references public.motoboys(id) on delete cascade,
  historico_id bigint references public.motoboy_status_historico(id) on delete set null,
  texto text not null check (char_length(texto) between 10 and 2000),
  criado_em timestamptz not null default now(),
  situacao text not null default 'aberta' check (situacao in ('aberta','deferida','indeferida')),
  resposta text, respondido_em timestamptz, respondido_por uuid references auth.users(id) on delete set null
);
alter table public.contestacoes enable row level security;
create policy "contestacoes: motoboy vê as suas" on public.contestacoes for select to authenticated using (motoboy_id = auth.uid());
create policy "contestacoes: admin" on public.contestacoes for select to authenticated using (public.is_admin());
revoke all on public.contestacoes from anon, authenticated;
grant select on public.contestacoes to authenticated;

drop function if exists public.definir_status_motoboy(uuid, text);
create or replace function public.definir_status_motoboy(p_motoboy uuid, p_status text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_de text;
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  if p_status not in ('pendente','aprovado','bloqueado','reprovado') then raise exception 'Status inválido'; end if;
  if char_length(trim(coalesce(p_motivo,''))) < 5 then raise exception 'Informe o motivo (mínimo 5 caracteres)'; end if;
  select status into v_de from motoboys where id = p_motoboy for update;
  if not found then raise exception 'Motoboy não encontrado'; end if;
  update motoboys set status = p_status, status_motivo = left(trim(p_motivo), 500), status_em = now(),
         online = case when p_status = 'aprovado' then online else false end
   where id = p_motoboy;
  insert into motoboy_status_historico (motoboy_id, de, para, motivo, admin_id) values (p_motoboy, v_de, p_status, left(trim(p_motivo), 500), auth.uid());
end $$;

create or replace function public.contestar_status(p_texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_hist bigint; v_id bigint;
begin
  if not exists (select 1 from motoboys where id = auth.uid() and status in ('bloqueado','reprovado')) then
    raise exception 'Só é possível contestar um bloqueio ou reprovação'; end if;
  if exists (select 1 from contestacoes where motoboy_id = auth.uid() and situacao = 'aberta') then
    raise exception 'Você já tem uma contestação em análise'; end if;
  select id into v_hist from motoboy_status_historico where motoboy_id = auth.uid() order by em desc limit 1;
  insert into contestacoes (motoboy_id, historico_id, texto) values (auth.uid(), v_hist, trim(p_texto)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.minha_situacao()
returns table(status text, motivo text, status_em timestamptz, contestacao_situacao text, contestacao_resposta text, contestacao_em timestamptz)
language sql stable security definer set search_path = public as $$
  select m.status, m.status_motivo, m.status_em, c.situacao, c.resposta, c.criado_em
  from motoboys m left join lateral (select * from contestacoes c where c.motoboy_id = m.id order by criado_em desc limit 1) c on true
  where m.id = auth.uid()
$$;

create or replace function public.admin_historico(p_motoboy uuid)
returns table(em timestamptz, de text, para text, motivo text, admin text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select h.em, h.de, h.para, h.motivo, coalesce(p.nome, 'admin') from motoboy_status_historico h
    left join profiles p on p.id = h.admin_id where h.motoboy_id = p_motoboy order by h.em desc;
end $$;

create or replace function public.admin_contestacoes()
returns table(id bigint, motoboy_id uuid, nome text, email text, status text, motivo text, texto text, criado_em timestamptz,
  situacao text, resposta text, respondido_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select c.id, c.motoboy_id, p.nome, u.email::text, m.status, m.status_motivo, c.texto, c.criado_em, c.situacao, c.resposta, c.respondido_em
    from contestacoes c join motoboys m on m.id = c.motoboy_id join profiles p on p.id = m.id join auth.users u on u.id = m.id
    order by (c.situacao = 'aberta') desc, c.criado_em desc;
end $$;

create or replace function public.responder_contestacao(p_id bigint, p_decisao text, p_resposta text)
returns void language plpgsql security definer set search_path = public as $$
declare v contestacoes;
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  if p_decisao not in ('deferida','indeferida') then raise exception 'Decisão inválida'; end if;
  if char_length(trim(coalesce(p_resposta,''))) < 5 then raise exception 'Escreva a resposta ao motoboy'; end if;
  update contestacoes set situacao = p_decisao, resposta = left(trim(p_resposta), 2000), respondido_em = now(), respondido_por = auth.uid()
   where id = p_id and situacao = 'aberta' returning * into v;
  if not found then raise exception 'Contestação não encontrada ou já respondida'; end if;
  if p_decisao = 'deferida' then
    perform definir_status_motoboy(v.motoboy_id, 'aprovado', 'Contestação deferida: ' || left(trim(p_resposta), 400));
  end if;
end $$;

-- admin_motoboys com os novos campos
drop function if exists public.admin_motoboys();
create or replace function public.admin_motoboys()
returns table(id uuid, nome text, telefone text, email text, cpf text, cnh text, placa text, modelo text,
  foto_path text, doc_path text, status text, enviado_em timestamptz, online boolean, local_em timestamptz,
  nascimento date, cnh_categoria text, cnh_primeira_hab date, cnh_validade date, curso_path text, antecedentes_path text,
  status_motivo text, contestacao_aberta boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select m.id, p.nome, p.telefone, u.email::text, m.cpf, m.cnh, m.placa, m.modelo, m.foto_path, m.doc_path,
    m.status, m.enviado_em, m.online, m.local_em, m.nascimento, m.cnh_categoria, m.cnh_primeira_hab, m.cnh_validade,
    m.curso_path, m.antecedentes_path, m.status_motivo,
    exists (select 1 from contestacoes c where c.motoboy_id = m.id and c.situacao = 'aberta')
    from motoboys m join profiles p on p.id = m.id join auth.users u on u.id = m.id
    order by exists (select 1 from contestacoes c where c.motoboy_id = m.id and c.situacao = 'aberta') desc,
             (m.status = 'pendente' and m.enviado_em is not null) desc, m.enviado_em desc nulls last;
end $$;

-- ===== 4. Exclusão de conta (chamada pela Edge Function "excluir-conta" com service_role) =====
alter table public.pedidos alter column cliente_id drop not null;
alter table public.pedidos drop constraint if exists pedidos_cliente_id_fkey,
  add constraint pedidos_cliente_id_fkey foreign key (cliente_id) references public.profiles(id) on delete set null;
alter table public.pedidos drop constraint if exists pedidos_motoboy_id_fkey,
  add constraint pedidos_motoboy_id_fkey foreign key (motoboy_id) references public.motoboys(id) on delete set null;
alter table public.pedidos add column if not exists anonimizado_em timestamptz;
alter table public.avaliacoes alter column cliente_id drop not null, alter column motoboy_id drop not null;
alter table public.avaliacoes drop constraint if exists avaliacoes_cliente_id_fkey,
  add constraint avaliacoes_cliente_id_fkey foreign key (cliente_id) references public.profiles(id) on delete set null;
alter table public.avaliacoes drop constraint if exists avaliacoes_motoboy_id_fkey,
  add constraint avaliacoes_motoboy_id_fkey foreign key (motoboy_id) references public.motoboys(id) on delete set null;
alter table public.posicoes drop constraint if exists posicoes_motoboy_id_fkey,
  add constraint posicoes_motoboy_id_fkey foreign key (motoboy_id) references public.motoboys(id) on delete cascade;

create table if not exists public.solicitacoes_exclusao (
  id bigint generated always as identity primary key,
  user_hash text not null,               -- sha256 do id (prova sem guardar o dado)
  papel text, origem text not null default 'app',
  solicitado_em timestamptz not null default now(), concluido_em timestamptz,
  pedidos_anonimizados int default 0, arquivos_removidos int default 0
);
alter table public.solicitacoes_exclusao enable row level security;
create policy "exclusoes: admin" on public.solicitacoes_exclusao for select to authenticated using (public.is_admin());
revoke all on public.solicitacoes_exclusao from anon, authenticated;
grant select on public.solicitacoes_exclusao to authenticated;

-- Anonimiza pedidos (guarda só o necessário para fins fiscais/legais: data, valor, km, status) e apaga dados ligados ao usuário.
create or replace function public.excluir_dados_usuario(p_uid uuid, p_origem text default 'app')
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; n int; v_id bigint;
begin
  select role into v_role from profiles where id = p_uid;
  if exists (select 1 from pedidos where (cliente_id = p_uid or motoboy_id = p_uid) and status in ('procurando','aceito','coletado')) then
    raise exception 'Há um pedido em andamento. Conclua ou cancele antes de excluir a conta.'; end if;
  update pedidos set retirada = 'Endereço removido (LGPD)', entrega = 'Endereço removido (LGPD)',
         ret_lat = round(ret_lat::numeric, 2), ret_lng = round(ret_lng::numeric, 2),
         ent_lat = round(ent_lat::numeric, 2), ent_lng = round(ent_lng::numeric, 2),
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
revoke execute on function public.excluir_dados_usuario(uuid, text) from public, anon, authenticated;
grant execute on function public.excluir_dados_usuario(uuid, text) to service_role;

-- ===== 5. Retenção automática (pg_cron) =====
create extension if not exists pg_cron;
insert into privado.segredos values ('retencao_secret', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (nome) do nothing;

-- GPS: posições com mais de 90 dias e de corridas encerradas há mais de 90 dias
create or replace function privado.limpar_gps() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from posicoes po using pedidos p where p.id = po.pedido_id
    and (po.em < now() - interval '90 days' or (p.status in ('entregue','cancelado') and coalesce(p.entregue_em, p.cancelado_em, p.criado_em) < now() - interval '90 days'));
  get diagnostics n = row_count;
  update motoboys set lat = null, lng = null where local_em < now() - interval '90 days';
  return n;
end $$;

-- Documentos de reprovados/bloqueados há mais de 30 dias: a Edge Function "retencao" apaga os arquivos do Storage
create or replace function privado.chamar_retencao() returns void language plpgsql security definer set search_path = public, privado as $$
begin
  perform net.http_post(url := 'https://waalgvcywtfnrrpkrhti.supabase.co/functions/v1/retencao',
    headers := jsonb_build_object('Content-Type','application/json','x-eja-secret',(select valor from privado.segredos where nome = 'retencao_secret')),
    body := '{}'::jsonb);
end $$;

-- Lista para a função de retenção (só service_role)
create or replace function public.retencao_docs_pendentes()
returns table(id uuid, paths text[]) language sql stable security definer set search_path = public as $$
  select m.id, array_remove(array[m.foto_path, m.doc_path, m.curso_path, m.antecedentes_path], null)
  from motoboys m where m.status in ('reprovado','bloqueado') and m.status_em < now() - interval '30 days'
    and (m.foto_path is not null or m.doc_path is not null or m.curso_path is not null or m.antecedentes_path is not null)
$$;
create or replace function public.retencao_docs_limpos(p_id uuid) returns void language sql security definer set search_path = public as $$
  update motoboys set foto_path = null, doc_path = null, curso_path = null, antecedentes_path = null where id = p_id
$$;
revoke execute on function public.retencao_docs_pendentes(), public.retencao_docs_limpos(uuid) from public, anon, authenticated;
grant execute on function public.retencao_docs_pendentes(), public.retencao_docs_limpos(uuid) to service_role;

select cron.unschedule(jobname) from cron.job where jobname in ('eja_limpar_gps','eja_retencao_docs');
select cron.schedule('eja_limpar_gps', '15 3 * * *', 'select privado.limpar_gps()');
select cron.schedule('eja_retencao_docs', '30 3 * * *', 'select privado.chamar_retencao()');

-- Permissões padrão das novas funções públicas
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('aceites_pendentes','registrar_aceites','enviar_cadastro_motoboy','definir_status_motoboy','contestar_status',
                             'minha_situacao','admin_historico','admin_contestacoes','responder_contestacao','admin_motoboys','cpf_valido','docs_do_papel','ip_requisicao') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Cadastro: registra o aceite do clique (checkbox) enviado nos metadados do signUp
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(new.raw_user_meta_data->>'role', 'cliente'); d record;
begin
  if v_role not in ('cliente','motoboy') then v_role := 'cliente'; end if;
  insert into public.profiles (id, role, nome, telefone)
  values (new.id, v_role, left(coalesce(new.raw_user_meta_data->>'nome',''),80), left(new.raw_user_meta_data->>'telefone',20));
  if v_role = 'motoboy' then insert into public.motoboys (id) values (new.id); end if;
  if (new.raw_user_meta_data->>'aceite_termos') = 'true' then
    for d in select * from documentos_vigentes where doc = any(docs_do_papel(v_role))
             and versao = coalesce(new.raw_user_meta_data->'aceite_versoes'->>doc, versao) loop
      insert into aceites_termos (user_id, doc, versao, user_agent, app_versao, origem, ip)
      values (new.id, d.doc, d.versao, left(new.raw_user_meta_data->>'user_agent', 400), left(new.raw_user_meta_data->>'app_versao', 30), 'cadastro', ip_requisicao());
    end loop;
  end if;
  return new;
end $$;

-- Pedidos anonimizados (cliente excluído) continuam visíveis ao admin
CREATE OR REPLACE FUNCTION public.admin_pedidos()
 RETURNS TABLE(id uuid, criado_em timestamp with time zone, cliente text, motoboy text, retirada text, entrega text, distancia_km numeric, preco numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then raise exception 'Apenas admin'; end if;
  return query select p.id, p.criado_em, c.nome, mp.nome, p.retirada, p.entrega, p.distancia_km, p.preco, p.status
    from pedidos p left join profiles c on c.id = p.cliente_id left join profiles mp on mp.id = p.motoboy_id
    order by p.criado_em desc limit 200;
end $function$
;
