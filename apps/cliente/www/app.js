// É-Já (cliente): pedir entrega, ver preço, acompanhar o motoboy ao vivo.
let mapa = null, mapaPed = null, origem = null, destino = null, rota = null;
let camadas = [], pedido = null, canal = null, motoMarker = null, camadasPed = [];

iniciarAuth({ role: "cliente", aoEntrar: carregar });

async function carregar() {
  iniciarMapa();
  iniciarPush("cliente", () => atualizarStatus());
  const { data } = await db.rpc("meu_pedido_ativo");
  if (data && data[0]) mostrarPedido(data[0]);
}

const ponto = (ll, cor) => L.circleMarker(ll, { radius: 9, color: "#0b0b0b", weight: 3, fillColor: cor, fillOpacity: 1 });
function novoMapa(id) {
  const m = L.map(id).setView(PELOTAS, 13);
  L.tileLayer(TILES, { maxZoom: 19, attribution: TILES_ATTR }).addTo(m);
  setTimeout(() => m.invalidateSize(), 100);
  return m;
}

function iniciarMapa() {
  if (mapa) return;
  mapa = novoMapa("mapa");
  autocompletar($("origem"), $("sugOrigem"), e => { origem = e; desenhar(); });
  autocompletar($("destino"), $("sugDestino"), e => { destino = e; desenhar(); });
}

async function desenhar() {
  camadas.forEach(c => c.remove()); camadas = []; rota = null;
  if (origem) camadas.push(ponto([origem.lat, origem.lng], COR.laranja).addTo(mapa));
  if (destino) camadas.push(ponto([destino.lat, destino.lng], COR.branco).addTo(mapa));
  if (!(origem && destino)) { if (origem || destino) mapa.setView([(origem || destino).lat, (origem || destino).lng], 15); return; }
  $("km").textContent = "Calculando rota…";
  rota = await calcularRota(origem, destino);
  if (rota) camadas.push(L.polyline(rota.linha, { color: COR.laranja, weight: 5 }).addTo(mapa));
  mapa.fitBounds(L.latLngBounds([[origem.lat, origem.lng], [destino.lat, destino.lng]]), { padding: [30, 30] });
  cotar();
}

function params() {
  return { p_ret_lat: origem.lat, p_ret_lng: origem.lng, p_ent_lat: destino.lat, p_ent_lng: destino.lng,
           p_rota_km: rota ? Number(rota.km.toFixed(2)) : null };
}

async function cotar() {
  const { data, error } = await db.rpc("cotar_preco", params());
  if (error) { $("km").textContent = erroMsg(error); $("valor").textContent = "—"; return; }
  $("valor").textContent = money(data[0].preco);
  $("km").textContent = Number(data[0].distancia_km).toLocaleString("pt-BR") + " km" + (data[0].fonte === "rota" ? " pela rua" : " (estimado)");
}

$("deliveryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (!origem || !destino || !$("origem").dataset.escolhido || !$("destino").dataset.escolhido) {
    alert("Escolha os dois endereços na lista de sugestões."); return;
  }
  const botao = ev.target.querySelector('button[type="submit"]');
  botao.disabled = true;
  try {
    const { data, error } = await db.rpc("criar_pedido", {
      p_retirada: $("origem").value.trim(), p_entrega: $("destino").value.trim(), p_item: $("tipo").value, ...params()
    });
    if (error) throw error;
    const p = data[0];
    mostrarPedido({ id: p.pedido_id, retirada: $("origem").value.trim(), entrega: $("destino").value.trim(),
      item: $("tipo").value, preco: p.valor, status: "procurando", codigo: p.cod,
      ret_lat: origem.lat, ret_lng: origem.lng, ent_lat: destino.lat, ent_lng: destino.lng });
  } catch (e) { alert("Não foi possível fazer o pedido: " + erroMsg(e)); }
  finally { botao.disabled = false; }
});

async function mostrarPedido(p) {
  pedido = p;
  show("formCard", false); show("pedido", true); show("btnCancelar", true); show("btnNovo", false);
  $("resumo").textContent = "Retirada: " + p.retirada + " | Entrega: " + p.entrega + " | Item: " + p.item + " | Valor: " + money(p.preco);
  if (!mapaPed) mapaPed = novoMapa("mapaPedido"); else setTimeout(() => mapaPed.invalidateSize(), 60);
  if (p.ret_lat == null) {   // pedido recuperado ao reabrir: busca coordenadas
    const { data } = await db.from("pedidos").select("ret_lat,ret_lng,ent_lat,ent_lng").eq("id", p.id).single();
    Object.assign(p, data);
  }
  camadasPed.forEach(c => c.remove());
  camadasPed = [ponto([p.ret_lat, p.ret_lng], COR.laranja).addTo(mapaPed), ponto([p.ent_lat, p.ent_lng], COR.branco).addTo(mapaPed)];
  mapaPed.fitBounds(L.latLngBounds([[p.ret_lat, p.ret_lng], [p.ent_lat, p.ent_lng]]), { padding: [30, 30] });
  atualizarStatus();
  // Tempo real: status do pedido + posição do motoboy (RLS garante que só recebemos os nossos).
  if (canal) db.removeChannel(canal);
  canal = db.channel("pedido-" + p.id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: "id=eq." + p.id }, atualizarStatus)
    .on("postgres_changes", { event: "*", schema: "public", table: "posicoes", filter: "pedido_id=eq." + p.id },
        msg => msg.new && msg.new.lat && moverMoto(msg.new.lat, msg.new.lng))
    .subscribe();
}

function moverMoto(lat, lng) {
  if (!mapaPed) return;
  if (!motoMarker) {
    motoMarker = L.marker([lat, lng], { icon: L.divIcon({ html: "🛵", className: "moto-icon", iconSize: [30, 30] }) }).addTo(mapaPed);
  } else motoMarker.setLatLng([lat, lng]);
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
  if (s.status === "aceito" || s.status === "coletado") {
    const { data: pos } = await db.from("posicoes").select("lat,lng").eq("pedido_id", pedido.id).maybeSingle();
    if (pos) moverMoto(pos.lat, pos.lng);
  } else if (motoMarker) { motoMarker.remove(); motoMarker = null; }
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
  origem = destino = rota = null; $("origem").value = $("destino").value = "";
  camadas.forEach(c => c.remove()); camadas = [];
  $("valor").textContent = "—"; $("km").textContent = "Escolha os dois endereços";
  setTimeout(() => mapa.invalidateSize(), 60);
}

setInterval(atualizarStatus, 10000);   // segurança caso o tempo real caia
