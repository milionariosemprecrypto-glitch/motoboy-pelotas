// Edge Function "notificar": chamada pelo banco (trigger pedidos_push) quando um pedido é criado ou muda de status.
// Envia push pelo Firebase Cloud Messaging (API HTTP v1).
// Segredos necessários (Supabase > Edge Functions > Secrets):
//   EJA_NOTIFICAR_SECRET  = mesmo valor de privado.segredos('notificar_secret')  (já configurado)
//   FCM_SERVICE_ACCOUNT   = JSON da conta de serviço do Firebase (Julio precisa criar)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let cache: { token: string; exp: number } | null = null;
async function googleToken(sa: any) {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token;
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt().setExpirationTime("1h").sign(key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  cache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cache.token;
}

async function enviar(sa: any, tokens: string[], title: string, body: string, data: Record<string, string>,
  canal = "eja_status", som = "eja_aceito") {
  if (!tokens.length) return 0;
  const access = await googleToken(sa);
  let ok = 0;
  for (const token of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, notification: { title, body }, data,
        android: { priority: "high", ttl: "30s", notification: { channel_id: canal, sound: som, default_vibrate_timings: true } } } }),
    });
    if (r.ok) ok++;
    else if (r.status === 404 || r.status === 400) await db.from("device_tokens").delete().eq("token", token); // token velho
  }
  return ok;
}

const msgs: Record<string, [string, string]> = {
  aceito: ["Motoboy a caminho!", "Seu pedido foi aceito. Acompanhe no mapa."],
  coletado: ["Item coletado", "O motoboy já está levando sua entrega."],
  entregue: ["Entrega concluída", "Obrigado por usar o É-Já!"],
  cancelado: ["Pedido cancelado", "Seu pedido foi cancelado."],
};

Deno.serve(async (req) => {
  if (req.headers.get("x-eja-secret") !== Deno.env.get("EJA_NOTIFICAR_SECRET")) return new Response("forbidden", { status: 403 });
  const { pedido_id, status } = await req.json();
  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!saJson) return Response.json({ ok: false, motivo: "FCM_SERVICE_ACCOUNT não configurado" });
  const sa = JSON.parse(saJson);
  const { data: p } = await db.from("pedidos").select("*").eq("id", pedido_id).single();
  if (!p) return Response.json({ ok: false, motivo: "pedido não encontrado" });

  let enviados = 0;
  if (status === "procurando") {
    // Pedido novo: avisa motoboys aprovados, online, com posição recente e perto da retirada.
    const { data: cfg } = await db.from("config").select("valor").eq("chave", "raio_aviso_km").single();
    const raio = Number(cfg?.valor ?? 5);
    const desde = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: motos } = await db.from("motoboys").select("id, lat, lng")
      .eq("status", "aprovado").eq("online", true).gte("local_em", desde);
    const perto = (motos ?? []).filter((m) => dist(m.lat, m.lng, p.ret_lat, p.ret_lng) <= raio).map((m) => m.id);
    if (perto.length) {
      const { data: t } = await db.from("device_tokens").select("token").eq("app", "motoboy").in("user_id", perto);
      enviados = await enviar(sa, (t ?? []).map((x) => x.token), "Nova corrida: R$ " + Number(p.preco).toFixed(2).replace(".", ","),
        p.retirada + " → " + p.entrega, { pedido_id: p.id, tipo: "nova_corrida" }, "eja_corrida", "eja_corrida");
    }
  } else if (msgs[status]) {
    const { data: t } = await db.from("device_tokens").select("token").eq("app", "cliente").eq("user_id", p.cliente_id);
    enviados = await enviar(sa, (t ?? []).map((x) => x.token), msgs[status][0], msgs[status][1], { pedido_id: p.id, tipo: status });
  }
  return Response.json({ ok: true, enviados });
});

function dist(a: number, b: number, c: number, d: number) {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
