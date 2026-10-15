// É-Já (cliente): pedir entrega e acompanhar em tempo real.
let mapa = null, pontos = [], marcadores = [], pedido = null, canal = null;

iniciarAuth({ role: "cliente", aoEntrar: carregar });

async function carregar() {
  iniciarMapa();
  const { data } = await db.rpc("meu_pedido_ativo");
  if (data && data[0]) mostrarPedido(data[0]);
}

function iniciarMapa() {
  if (mapa) return;
  mapa = L.map("mapa").setView(PELOTAS, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
  mapa.on("click", e => {
    if (pontos.length >= 2) return;
    pontos.push(e.latlng);
    const cor = pontos.length === 1 ? "#087e67" : "#b8372a";
    marcadores.push(L.circleMarker(e.latlng, { radius: 9, color: "#fff", weight: 3, fillColor: cor, fillOpacity: 1 }).addTo(mapa));
    if (pontos.length === 2) cotar();
  });
  setTimeout(() => mapa.invalidateSize(), 100);
}

function limparPontos() {
  marcadores.forEach(m => m.remove());
  pontos = []; marcadores = [];
  $("valor").textContent = "—";
  $("km").textContent = "Marque os dois pontos no mapa";
}

function coords() {
  const [a, b] = pontos;
  return { p_ret_lat: a.lat, p_ret_lng: a.lng, p_ent_lat: b.lat, p_ent_lng: b.lng };
}

async function cotar() {
  const { data, error } = await db.rpc("cotar_preco", coords());
  if (error) { $("km").textContent = erroMsg(error); return; }
  $("valor").textContent = money(data[0].preco);
  $("km").textContent = "Aprox. " + Number(data[0].distancia_km).toLocaleString("pt-BR") + " km";
}

$("deliveryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (pontos.length < 2) { alert("Toque no mapa para marcar a retirada e a entrega."); return; }
  const botao = ev.target.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const { data, error } = await db.rpc("criar_pedido", {
      p_retirada: $("origem").value.trim(), p_entrega: $("destino").value.trim(), p_item: $("tipo").value, ...coords()
    });
    if (error) throw error;
    const p = data[0];
    mostrarPedido({ id: p.pedido_id, retirada: $("origem").value.trim(), entrega: $("destino").value.trim(),
                    item: $("tipo").value, preco: p.valor, status: "procurando", codigo: p.cod });
  } catch (e) { alert("Não foi possível fazer o pedido: " + erroMsg(e)); }
  finally { botao.disabled = false; }
});

function mostrarPedido(p) {
  pedido = p;
  show("formCard", false); show("pedido", true);
  show("btnCancelar", true); show("btnNovo", false);
  $("resumo").textContent = "Retirada: " + p.retirada + " | Entrega: " + p.entrega + " | Item: " + p.item + " | Valor: " + money(p.preco);
  atualizarStatus();
  // Tempo real: o Supabase avisa quando o pedido muda (RLS garante que só recebemos os nossos).
  if (canal) db.removeChannel(canal);
  canal = db.channel("pedido-" + p.id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: "id=eq." + p.id }, atualizarStatus)
    .subscribe();
}

async function atualizarStatus() {
  if (!pedido) return;
  const { data } = await db.rpc("status_pedido", { p_id: pedido.id });
  const s = data && data[0];
  if (!s) return;
  const moto = s.motoboy_nome ? s.motoboy_nome + (s.placa ? " (" + s.modelo + " · " + s.placa + ")" : "") : "";
  const cod = " Código para o destinatário: " + pedido.codigo;
  const textos = {
    procurando: "Procurando um motoboy disponível…",
    aceito: moto + " aceitou e está indo buscar o item." + cod,
    coletado: moto + " coletou o item e está a caminho." + cod,
    entregue: "Entrega concluída! Obrigado por usar o É-Já.",
    cancelado: "Pedido cancelado."
  };
  $("estado").textContent = textos[s.status] || s.status;
  if (s.status === "entregue" || s.status === "cancelado") { show("btnCancelar", false); show("btnNovo", true); }
}

async function cancelarPedido() {
  if (!pedido) return;
  const { data, error } = await db.rpc("cancelar_pedido", { p_id: pedido.id });
  if (error || data === false) { alert("Este pedido não pode mais ser cancelado."); return; }
  atualizarStatus();
}

function novoPedido() {
  if (canal) db.removeChannel(canal);
  pedido = null; canal = null;
  show("pedido", false); show("formCard", true);
  limparPontos();
  setTimeout(() => mapa.invalidateSize(), 60);
}

// Segurança extra caso o tempo real caia: confere a cada 10 s.
setInterval(atualizarStatus, 10000);
