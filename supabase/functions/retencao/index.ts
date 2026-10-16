// Edge Function "retencao": chamada diariamente pelo pg_cron (job eja_retencao_docs).
// Apaga do Storage os documentos de motoboys reprovados/bloqueados há mais de 30 dias (Política de Privacidade).
import { createClient } from "npm:@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.headers.get("x-eja-secret") !== Deno.env.get("EJA_RETENCAO_SECRET")) return new Response("forbidden", { status: 403 });
  const { data, error } = await admin.rpc("retencao_docs_pendentes");
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 });
  let arquivos = 0;
  for (const m of data ?? []) {
    const { data: lista } = await admin.storage.from("motoboy-docs").list(m.id, { limit: 1000 });
    if (lista?.length) {
      const { data: del } = await admin.storage.from("motoboy-docs").remove(lista.map((a) => `${m.id}/${a.name}`));
      arquivos += del?.length ?? 0;
    }
    await admin.rpc("retencao_docs_limpos", { p_id: m.id });
  }
  return Response.json({ ok: true, motoboys: (data ?? []).length, arquivos });
});
