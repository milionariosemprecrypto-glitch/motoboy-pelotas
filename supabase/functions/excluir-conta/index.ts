// Edge Function "excluir-conta": o próprio usuário (JWT) pede a exclusão da conta (LGPD art. 18, VI; Google Play).
// 1) anonimiza pedidos e apaga dados ligados (SQL excluir_dados_usuario) 2) remove arquivos motoboy-docs/<uid>/*
// 3) apaga o usuário do Auth (perfil e motoboy saem em cascata). Pedidos ficam anonimizados para fins fiscais/legais.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp({ erro: "Use POST" }, 405);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: eu } = await admin.auth.getUser(jwt);
  if (eu || !u?.user) return resp({ erro: "Faça login novamente" }, 401);
  const uid = u.user.id;
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  if (body.confirmacao !== "EXCLUIR") return resp({ erro: "Digite EXCLUIR para confirmar" }, 400);

  const { data: r, error: e1 } = await admin.rpc("excluir_dados_usuario", { p_uid: uid, p_origem: body.origem === "web" ? "web" : "app" });
  if (e1) return resp({ erro: e1.message }, 409);

  // Arquivos do motoboy
  let removidos = 0;
  const { data: arquivos } = await admin.storage.from("motoboy-docs").list(uid, { limit: 1000 });
  if (arquivos && arquivos.length) {
    const { data: del } = await admin.storage.from("motoboy-docs").remove(arquivos.map((a) => `${uid}/${a.name}`));
    removidos = del?.length ?? 0;
  }
  const { error: e2 } = await admin.auth.admin.deleteUser(uid);
  if (e2) return resp({ erro: "Falha ao remover login: " + e2.message }, 500);
  await admin.from("solicitacoes_exclusao").update({ concluido_em: new Date().toISOString(), arquivos_removidos: removidos }).eq("id", r.solicitacao);
  return resp({ ok: true, pedidos_anonimizados: r.pedidos, arquivos_removidos: removidos });
});
