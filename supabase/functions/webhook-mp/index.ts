// Confirma pagamento aprovado no Mercado Pago e libera o repasse se a corrida já foi entregue.
// Segredo: MERCADOPAGO_ACCESS_TOKEN (o mesmo da função cobranca). O aviso só vale depois
// de consultar o pagamento na API — o corpo do webhook não basta.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) return Response.json({ ok: false, motivo: "sem chave" });
  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const id = body?.data?.id || url.searchParams.get("id") || url.searchParams.get("data.id");
  if (!id) return Response.json({ ok: true, ignorado: true });
  const r = await fetch("https://api.mercadopago.com/v1/payments/" + id, {
    headers: { Authorization: "Bearer " + token }
  });
  const pay = await r.json();
  if (!r.ok || pay.status !== "approved") return Response.json({ ok: true, status: pay.status || r.status });
  const pedidoId = pay.external_reference;
  if (!pedidoId) return Response.json({ ok: false, motivo: "sem pedido" });
  await db.from("pagamentos").update({
    status: "pago", pago_em: new Date().toISOString(), referencia: String(pay.id), provedor: "mercadopago"
  }).eq("pedido_id", pedidoId);
  const { data: pedido } = await db.from("pedidos").select("status").eq("id", pedidoId).maybeSingle();
  if (pedido?.status === "entregue") await db.rpc("liquidar_pedido", { p_id: pedidoId });
  return Response.json({ ok: true, pedido_id: pedidoId });
});
