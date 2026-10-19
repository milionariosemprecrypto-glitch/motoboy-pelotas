// Aplica as migrations num Postgres local (PGlite) e roda os testes SQL.
// Não toca no projeto Supabase de produção.
//   npm install --prefix /tmp/pglite-harness @electric-sql/pglite
//   node tests/sql_harness.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/tmp/pglite-harness/package.json");
const { PGlite } = require("@electric-sql/pglite");

const root = path.resolve(import.meta.dirname, "..");
const migDir = path.join(root, "supabase/migrations");

const prelude = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant anon, authenticated, service_role to current_user;

create schema if not exists extensions;
-- PGlite não traz pgcrypto. O hash aqui só precisa existir para a exclusão de conta rodar;
-- em produção a migration usa extensions.digest (pgcrypto) de verdade.
create or replace function extensions.digest(data text, algo text) returns bytea
language sql immutable as $$
  select decode(md5(coalesce(data, '') || ':' || coalesce(algo, '')), 'hex')
$$;
create or replace function extensions.gen_random_bytes(len int) returns bytea
language plpgsql volatile as $$
declare out bytea := ''::bytea;
begin
  while octet_length(out) < len loop
    out := out || decode(md5(random()::text || clock_timestamp()::text), 'hex');
  end loop;
  return substring(out from 1 for len);
end $$;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select case
    when coalesce(current_setting('request.jwt.claims', true), '') = '' then null::uuid
    else nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  end
$$;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;

create schema if not exists net;
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}')
returns bigint language sql as $$ select 1::bigint $$;

create schema if not exists cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique,
  schedule text,
  command text
);
create or replace function cron.unschedule(p_jobname text) returns boolean
language plpgsql as $$
begin
  delete from cron.job j where j.jobname = p_jobname;
  return found;
end $$;
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text) returns bigint
language plpgsql as $$
declare id bigint;
begin
  insert into cron.job (jobname, schedule, command) values (p_jobname, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into id;
  return id;
end $$;

create publication supabase_realtime;
`;

function preparar(sql) {
  return sql
    .replace(/create extension if not exists pg_net with schema extensions;/gi, "select 1;")
    .replace(/create extension if not exists pg_cron;/gi, "select 1;");
}

async function aplicar(db, arquivo) {
  const sql = preparar(fs.readFileSync(arquivo, "utf8"));
  try {
    await db.exec(sql);
  } catch (e) {
    const onde = e.where ? " (" + String(e.where).split("\n")[0] + ")" : "";
    throw new Error(path.basename(arquivo) + ": " + (e.message || e).toString().split("\n")[0] + onde);
  }
}

async function rodarTeste(db, arquivo) {
  const sql = fs.readFileSync(arquivo, "utf8").replace(/\s*rollback;\s*$/i, "");
  let resultados;
  try {
    resultados = await db.exec(sql);
  } catch (e) {
    throw new Error(path.basename(arquivo) + " falhou ao executar: " + (e.message || e).toString().split("\n").slice(0, 20).join("\n"));
  }
  const linhas = [];
  for (const r of resultados || []) {
    for (const row of r.rows || []) {
      if (row.resultado) linhas.push(...row.resultado);
      else if (row.teste) linhas.push(row);
    }
  }
  if (!linhas.length) {
    const fim = await db.query("select teste, ok, detalhe from r order by teste");
    linhas.push(...fim.rows);
  }
  const ruins = linhas.filter(l => l.ok !== true);
  await db.exec("rollback");
  return { linhas, ruins };
}

const db = new PGlite();
await db.exec(prelude);
const migrations = fs.readdirSync(migDir).filter(f => f.endsWith(".sql")).sort();
for (const f of migrations) {
  process.stdout.write("migration " + f + " … ");
  await aplicar(db, path.join(migDir, f));
  console.log("ok");
}

const testes = [
  "supabase/tests/rls_test.sql",
  "supabase/tests/compliance_test.sql",
  "supabase/tests/endereco_chat_test.sql"
];
let falhas = 0;
for (const t of testes) {
  process.stdout.write(t + " … ");
  const { linhas, ruins } = await rodarTeste(db, path.join(root, t));
  if (ruins.length) {
    falhas += ruins.length;
    console.log("FALHOU");
    for (const r of ruins) console.log("  - " + r.teste + " | " + r.detalhe);
  } else {
    console.log("ok (" + linhas.length + ")");
  }
}
await db.close();
if (falhas) {
  console.error(falhas + " asserção(ões) falharam");
  process.exit(1);
}
console.log("sql_harness: ok");
