// Cria a cobrança de um pedido. Sem MERCADOPAGO_ACCESS_TOKEN grava simulado e não cobra.
// Segredo (Supabase > Edge Functions > Secrets), nunca no app:
//   MERCADOPAGO_ACCESS_TOKEN
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData } = await userDb.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ erro: "Faça login" }, 401);
  const { pedido_id } = await req.json();
  const db = createClient(url, service);
  const { data: p } = await db.from("pedidos").select("*").eq("id", pedido_id).eq("cliente_id", user.id).maybeSingle();
  if (!p) return json({ erro: "Pedido não encontrado" }, 404);

  if (p.forma_pagamento === "dinheiro") {
    await db.from("pagamentos").upsert({
      pedido_id: p.id, forma: "dinheiro", status: "pago", valor_total: p.preco,
      valor_plataforma: p.valor_plataforma ?? 0, valor_motoboy: p.valor_motoboy ?? 0,
      provedor: "especie", pago_em: new Date().toISOString()
    }, { onConflict: "pedido_id" });
    return json({ modo: "especie", status: "pago", mensagem: "Pague o total ao motoboy em dinheiro. A parte da plataforma entra no acerto depois.", checkout_url: null });
  }
  if (p.forma_pagamento !== "pix" && p.forma_pagamento !== "cartao") {
    return json({ erro: "Forma de pagamento inválida" }, 400);
  }

  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) {
    await db.from("pagamentos").upsert({
      pedido_id: p.id, forma: p.forma_pagamento, status: "simulado", valor_total: p.preco,
      valor_plataforma: p.valor_plataforma ?? 0, valor_motoboy: p.valor_motoboy ?? 0, provedor: "mock"
    }, { onConflict: "pedido_id" });
    return json({
      modo: "simulado", status: "simulado", checkout_url: null,
      mensagem: "Cobrança simulada: falta a chave do Mercado Pago. Você não foi cobrado."
    });
  }

  const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ title: "Entrega É-Já", quantity: 1, currency_id: "BRL", unit_price: Number(p.preco) }],
      external_reference: p.id,
      metadata: { pedido_id: p.id, forma: p.forma_pagamento },
      notification_url: url + "/functions/v1/webhook-mp"
    })
  });
  const j = await pref.json();
  if (!pref.ok) {
    return json({ erro: "Mercado Pago não criou a cobrança", detalhe: j }, 502);
  }
  await db.from("pagamentos").upsert({
    pedido_id: p.id, forma: p.forma_pagamento, status: "pendente", valor_total: p.preco,
    valor_plataforma: p.valor_plataforma ?? 0, valor_motoboy: p.valor_motoboy ?? 0,
    provedor: "mercadopago", referencia: j.id, checkout_url: j.init_point
  }, { onConflict: "pedido_id" });
  return json({
    modo: "mercadopago", status: "pendente", checkout_url: j.init_point,
    mensagem: "Abra o Mercado Pago para pagar o total. A parte da plataforma fica retida nessa cobrança."
  });
});
