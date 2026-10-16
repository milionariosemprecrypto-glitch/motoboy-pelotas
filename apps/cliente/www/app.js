// É-Já (cliente): início estilo app de corrida, planejar entrega, preço antes, rastreio ao vivo, avaliação.
const CATEGORIAS = [
  { id: "rapida", nome: "Entrega rápida", icone: "🛵", itens: ["Pequena encomenda", "Documento ou envelope", "Compra de loja", "Outro item permitido"] },
  { id: "docs", nome: "Documentos", icone: "📄", itens: ["Documento ou envelope", "Contrato / cartório", "Chave"] },
  { id: "comida", nome: "Comida/Lanche", icone: "🍔", itens: ["Lanche / refeição", "Bebidas", "Doces / bolo"] },
  { id: "farmacia", nome: "Farmácia", icone: "💊", itens: ["Remédio (com receita, se exigido)", "Produtos de farmácia"] },
  { id: "mercado", nome: "Mercado", icone: "🛒", itens: ["Compras de mercado (até 10 kg)", "Hortifruti", "Gás de cozinha NÃO permitido"] },
  { id: "loja", nome: "Lojas", icone: "🛍️", itens: ["Compra de loja", "Roupas / calçados", "Eletrônico pequeno"] }
];
let categoria = CATEGORIAS[0];
let aqui = null, origem = null, destino = null, rota = null, camadas = [];
let mapa = null, mapaPed = null, mapaPino = null, pedido = null, canal = null, motoMarker = null, camadasPed = [];
let usuario = null, historico = [];
const guardar = {
  ler: k => { try { return JSON.parse(localStorage.getItem("eja_" + k)); } catch { return null; } },
  gravar: (k, v) => { try { localStorage.setItem("eja_" + k, JSON.stringify(v)); } catch {} }
};
const toast = (msg, ms = 2600) => { const t = $("toast"); t.textContent = msg; show("toast", true); clearTimeout(t._t); t._t = setTimeout(() => show("toast", false), ms); };
const dist = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const kmTxt = km => km < 1 ? Math.round(km * 1000) + " m" : km.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " km";

// ---------- Boas-vindas (3 slides) ----------
let slide = 0;
if (!guardar.ler("onboarding_ok")) show("telaOnboarding", true);
function proximoSlide() { if (slide >= 2) return fimOnboarding(); irSlide(slide + 1); }
function irSlide(i) {
  slide = i; $("obSlides").style.transform = `translateX(-${i * 100}%)`;
  document.querySelectorAll(".ob-pontos i").forEach((p, j) => p.classList.toggle("on", j === i));
  $("obProximo").textContent = i === 2 ? "Começar" : "Próximo";
}
function fimOnboarding() { guardar.gravar("onboarding_ok", true); show("telaOnboarding", false); }
(() => { let x0 = null; const el = $("obSlides");
  el.addEventListener("touchstart", e => x0 = e.touches[0].clientX);
  el.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0;
    if (dx < -40 && slide < 2) irSlide(slide + 1); if (dx > 40 && slide > 0) irSlide(slide - 1); x0 = null; }); })();

// ---------- Login ----------
iniciarAuth({ role: "cliente", aoEntrar: carregar });

async function carregar(u) {
  usuario = u;
  $("contaEmail").textContent = u.email;
  db.from("profiles").select("nome").eq("id", u.id).maybeSingle().then(({ data }) => { if (data && data.nome) $("contaNome").textContent = data.nome; });
  montarServicos(); irAba("home"); atualizarLocal(false);
  iniciarPush("cliente", () => atualizarStatus());
  autocompletar($("origem"), $("sugOrigem"), e => { origem = e; seguirSePronto(); });
  autocompletar($("destino"), $("sugDestino"), e => { destino = e; seguirSePronto(); });
  await carregarHistorico();
  const { data } = await db.rpc("meu_pedido_ativo");
  if (data && data[0]) mostrarPedido(data[0]);
}

// ---------- Navegação ----------
function irAba(a) {
  ["home", "opcoes", "atividade", "conta"].forEach(x => {
    show(x, x === a); $("nav" + x[0].toUpperCase() + x.slice(1)).classList.toggle("on", x === a);
  });
  if (a === "atividade") carregarHistorico();
  if (a === "conta") { $("contaCasa").textContent = (guardar.ler("casa") || {}).nome || "Adicionar"; $("contaTrabalho").textContent = (guardar.ler("trabalho") || {}).nome || "Adicionar"; }
  window.scrollTo(0, 0);
}
const telaSobre = (id, on) => { show(id, on); document.body.classList.toggle("sem-nav", !!document.querySelector(".tela.sobre:not(.hidden)")); };

// ---------- Localização atual ----------
function atualizarLocal(avisar) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async p => {
    aqui = { lat: p.coords.latitude, lng: p.coords.longitude };
    if (!dentroPelotas(aqui.lat, aqui.lng)) { $("locAtual").textContent = "Fora de Pelotas"; return; }
    const nome = await nomeDoPonto(aqui.lat, aqui.lng);
    aqui.nome = nome || "Minha localização";
    $("locAtual").textContent = aqui.nome;
    montarLugares();
  }, () => avisar && toast("Ative a localização para usar seu endereço atual."), { enableHighAccuracy: true, timeout: 10000 });
}

// ---------- Início: lugares salvos, recentes, serviços ----------
function recentes() {
  const vistos = new Set(), out = [];
  for (const p of historico) {
    if (!p.ent_lat || vistos.has(p.entrega)) continue;
    vistos.add(p.entrega); out.push({ nome: p.entrega, lat: p.ent_lat, lng: p.ent_lng });
    if (out.length >= 8) break;
  }
  return out;
}
function itemLugar(icone, titulo, sub, onclick) {
  const b = document.createElement("button"); b.className = "item-lista"; b.onclick = onclick;
  b.innerHTML = `<i>${icone}</i><div><b></b><span></span></div><em>›</em>`;
  b.querySelector("b").textContent = titulo; b.querySelector("span").textContent = sub; return b;
}
function montarLugares() {
  const el = $("lugares"); el.textContent = "";
  const r = recentes()[0];
  if (r) el.append(itemLugar("🕒", r.nome.split(" · ")[0], r.nome.split(" · ")[1] || "Pelotas", () => escolherDestino(r)));
  const casa = guardar.ler("casa");
  el.append(itemLugar("🏠", "Casa", casa ? casa.nome : "Adicionar endereço de casa", () => casa ? escolherDestino(casa) : definirLugar("casa")));
  const trab = guardar.ler("trabalho");
  if (trab) el.append(itemLugar("💼", "Trabalho", trab.nome, () => escolherDestino(trab)));
  show("cardBoasVindas", historico.length === 0);
}
function montarServicos() {
  const tile = c => { const b = document.createElement("button"); b.className = "servico";
    b.innerHTML = `<span class="bolha">${c.icone}</span><span></span>`; b.lastChild.textContent = c.nome;
    b.onclick = () => { categoria = c; $("categoriaAtual").textContent = c.nome; irAba("home"); abrirPlano(); }; return b; };
  $("servicos").textContent = ""; CATEGORIAS.slice(0, 5).forEach(c => $("servicos").append(tile(c)));
  $("gradeServicos").textContent = ""; CATEGORIAS.forEach(c => $("gradeServicos").append(tile(c)));
}
function definirLugar(tipo) {
  abrirPlano();
  $("destino").placeholder = "Digite o endereço de " + (tipo === "casa" ? "casa" : "trabalho");
  $("destino").focus();
  definindo = tipo;
}
let definindo = null;
function usarLugar(tipo) { const l = guardar.ler(tipo); if (l) escolherDestino(l); else definirLugar(tipo); }
function maisTarde() { toast("Agendamento chega em breve! Por enquanto, as entregas são para agora."); }

// ---------- Planejar ----------
function abrirPlano() {
  telaSobre("telaPlano", true);
  if (!origem && aqui && aqui.nome) { origem = { ...aqui }; $("origem").value = aqui.nome; $("origem").dataset.escolhido = "1"; }
  const lista = $("listaRecentes"); lista.textContent = "";
  const base = origem || aqui;
  const rec = recentes();
  if (!rec.length) lista.innerHTML = '<p class="small" style="padding:8px 4px">Seus endereços recentes aparecem aqui.</p>';
  rec.forEach(r => {
    const it = itemLugar("🕒", r.nome.split(" · ")[0], r.nome.split(" · ")[1] || "Pelotas", () => escolherDestino(r));
    if (base) it.querySelector("i").insertAdjacentHTML("beforeend", `<small>${kmTxt(dist(base, r))}</small>`);
    lista.append(it);
  });
  setTimeout(() => (origem ? $("destino") : $("origem")).focus(), 50);
}
function fecharPlano() { telaSobre("telaPlano", false); definindo = null; $("destino").placeholder = "Para onde?"; }
function escolherDestino(e) {
  destino = { nome: e.nome, lat: e.lat, lng: e.lng };
  $("destino").value = e.nome; $("destino").dataset.escolhido = "1";
  if (!origem) { abrirPlano(); toast("Agora escolha o endereço de retirada."); $("origem").focus(); return; }
  seguirSePronto();
}
function seguirSePronto() {
  if (definindo && destino) { guardar.gravar(definindo, destino); toast((definindo === "casa" ? "Casa" : "Trabalho") + " salvo!");
    definindo = null; destino = null; $("destino").value = ""; fecharPlano(); montarLugares(); return; }
  if (origem && destino && $("origem").dataset.escolhido && $("destino").dataset.escolhido) abrirConfirmar();
}

// ---------- Escolher no mapa (pino arrastável) ----------
function abrirPinoMapa() {
  telaSobre("telaPino", true);
  if (!mapaPino) { mapaPino = criarMapa("mapaPino"); mapaPino.on("moveend", nomearPino); }
  setTimeout(() => { mapaPino.invalidateSize(); const c = destino || aqui; mapaPino.setView(c ? [c.lat, c.lng] : PELOTAS, 16); }, 80);
}
let pinoAtual = null;
async function nomearPino() {
  const c = mapaPino.getCenter(); pinoAtual = { lat: c.lat, lng: c.lng, nome: null };
  $("pinoNome").textContent = "Buscando endereço…";
  const n = await nomeDoPonto(c.lat, c.lng); pinoAtual.nome = n || "Ponto no mapa";
  $("pinoNome").textContent = pinoAtual.nome;
}
function fecharPino() { telaSobre("telaPino", false); }
function confirmarPino() {
  if (!pinoAtual || !pinoAtual.nome) return;
  if (!dentroPelotas(pinoAtual.lat, pinoAtual.lng)) return toast("Por enquanto atendemos só Pelotas.");
  fecharPino(); escolherDestino(pinoAtual);
}

// Enquadra pontos no pedaço do mapa que fica visível acima da folha inferior.
function enquadrar(m, pts, folhaSel) {
  ajustarMapa(m);
  const f = document.querySelector(folhaSel); const h = f ? f.getBoundingClientRect().height : 300;
  m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [50, 90], paddingBottomRight: [50, h + 40], maxZoom: 16 });
  setTimeout(() => ajustarMapa(m), 300);
}

// ---------- Confirmar com preço ----------
async function abrirConfirmar() {
  telaSobre("telaConfirmar", true);
  $("resOrigem").textContent = $("origem").value; $("resDestino").textContent = $("destino").value;
  $("tagCategoria").textContent = categoria.nome;
  $("tipo").innerHTML = ""; categoria.itens.filter(i => !/NÃO/.test(i)).forEach(i => $("tipo").add(new Option(i, categoria.nome + ": " + i)));
  if (!mapa) mapa = criarMapa("mapa");
  await new Promise(r => setTimeout(r, 120));
  camadas.forEach(c => c.remove());
  camadas = [L.marker([origem.lat, origem.lng], { icon: icone.retirada() }).addTo(mapa), L.marker([destino.lat, destino.lng], { icon: icone.entrega() }).addTo(mapa)];
  enquadrar(mapa, [[origem.lat, origem.lng], [destino.lat, destino.lng]], "#deliveryForm");
  $("valor").textContent = "—"; $("km").textContent = "Calculando rota…";
  rota = await calcularRota(origem, destino);
  if (rota) { camadas.push(L.polyline(rota.linha, ROTA).addTo(mapa)); enquadrar(mapa, rota.linha, "#deliveryForm"); }
  const { data, error } = await db.rpc("cotar_preco", params());
  if (error) { $("km").textContent = erroMsg(error); return; }
  $("valor").textContent = money(data[0].preco);
  $("km").textContent = Number(data[0].distancia_km).toLocaleString("pt-BR") + " km" + (data[0].fonte === "rota" ? " pela rua" : " (estimado)") + " · ~" + Math.max(8, Math.round(data[0].distancia_km * 3 + 6)) + " min";
}
function voltarDoConfirmar() { telaSobre("telaConfirmar", false); abrirPlano(); }
function params() {
  return { p_ret_lat: origem.lat, p_ret_lng: origem.lng, p_ent_lat: destino.lat, p_ent_lng: destino.lng, p_rota_km: rota ? Number(rota.km.toFixed(2)) : null };
}

$("deliveryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const botao = $("btnConfirmar"); botao.disabled = true;
  try {
    const { data, error } = await db.rpc("criar_pedido", { p_retirada: $("origem").value.trim(), p_entrega: $("destino").value.trim(), p_item: $("tipo").value.slice(0, 60), ...params() });
    if (error) throw error;
    const p = data[0];
    telaSobre("telaConfirmar", false); telaSobre("telaPlano", false);
    mostrarPedido({ id: p.pedido_id, retirada: $("origem").value.trim(), entrega: $("destino").value.trim(), item: $("tipo").value, preco: p.valor,
      status: "procurando", codigo: p.cod, ret_lat: origem.lat, ret_lng: origem.lng, ent_lat: destino.lat, ent_lng: destino.lng });
  } catch (e) { toast("Não foi possível pedir: " + erroMsg(e), 4000); }
  finally { botao.disabled = false; }
});

// ---------- Pedido em andamento ----------
async function mostrarPedido(p) {
  pedido = p; ultimoS = null;
  telaSobre("pedido", true); show("btnCancelar", true); show("btnNovo", false); show("avaliar", false); show("btnWhats", true);
  $("resumo").textContent = p.retirada + " → " + p.entrega + " · " + p.item + " · " + money(p.preco);
  if (!mapaPed) mapaPed = criarMapa("mapaPedido"); else setTimeout(() => mapaPed.invalidateSize(), 60);
  if (p.ret_lat == null) { const { data } = await db.from("pedidos").select("ret_lat,ret_lng,ent_lat,ent_lng").eq("id", p.id).single(); Object.assign(p, data); }
  camadasPed.forEach(c => c.remove());
  camadasPed = [L.marker([p.ret_lat, p.ret_lng], { icon: icone.retirada() }).addTo(mapaPed), L.marker([p.ent_lat, p.ent_lng], { icon: icone.entrega() }).addTo(mapaPed)];
  setTimeout(() => enquadrar(mapaPed, [[p.ret_lat, p.ret_lng], [p.ent_lat, p.ent_lng]], "#pedido .folha"), 150);
  atualizarStatus();
  if (canal) db.removeChannel(canal);
  canal = db.channel("pedido-" + p.id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: "id=eq." + p.id }, atualizarStatus)
    .on("postgres_changes", { event: "*", schema: "public", table: "posicoes", filter: "pedido_id=eq." + p.id }, m => m.new && m.new.lat && moverMoto(m.new.lat, m.new.lng))
    .subscribe();
}
function moverMoto(lat, lng) {
  if (!mapaPed) return;
  pedido.motoPos = [lat, lng];
  if (!motoMarker) motoMarker = L.marker([lat, lng], { icon: icone.moto(), zIndexOffset: 1000 }).addTo(mapaPed);
  else motoMarker.setLatLng([lat, lng]);
}
let ultimoS = null;
async function atualizarStatus() {
  if (!pedido) return;
  const { data } = await db.rpc("status_pedido", { p_id: pedido.id });
  const s = data && data[0]; if (!s) return;
  pedido.status = s.status; pedido.moto = s.motoboy_nome ? s.motoboy_nome + (s.placa ? " · " + s.modelo + " " + s.placa : "") : "";
  const textos = {
    procurando: "Procurando um motoboy disponível…",
    aceito: (pedido.moto || "Motoboy") + " aceitou e está indo buscar o item.",
    coletado: (pedido.moto || "Motoboy") + " coletou o item e está a caminho.",
    entregue: "Entrega concluída! Obrigado por usar o É-Já.",
    cancelado: "Pedido cancelado."
  };
  $("estado").textContent = textos[s.status] || s.status;
  show("barraBuscaCli", s.status === "procurando");
  show("codigoBox", ["aceito", "coletado"].includes(s.status)); $("codigoTxt").textContent = pedido.codigo || "";
  if (s.status === "aceito" && ultimoS && ultimoS !== "aceito") Alerta.tocarAceito();
  ultimoS = s.status;
  if (s.status === "aceito" || s.status === "coletado") {
    const { data: pos } = await db.from("posicoes").select("lat,lng").eq("pedido_id", pedido.id).maybeSingle();
    if (pos) moverMoto(pos.lat, pos.lng);
  } else if (motoMarker) { motoMarker.remove(); motoMarker = null; }
  if (s.status === "entregue" || s.status === "cancelado") {
    show("btnCancelar", false); show("btnNovo", true); show("btnWhats", false);
    if (s.status === "entregue") montarAvaliacao();
  }
}
async function cancelarPedido() {
  if (!pedido) return;
  if (!confirm("Cancelar este pedido?")) return;
  const { data, error } = await db.rpc("cancelar_pedido", { p_id: pedido.id });
  if (error || data === false) { toast("Este pedido não pode mais ser cancelado."); return; }
  atualizarStatus();
}
function sairDoPedido() {
  if (pedido && ["procurando", "aceito", "coletado"].includes(pedido.status)) { telaSobre("pedido", false); toast("Seu pedido continua em Atividade."); irAba("atividade"); return; }
  novoPedido();
}
function novoPedido() {
  if (canal) db.removeChannel(canal);
  pedido = null; canal = null; origem = null; destino = null; rota = null;
  if (motoMarker) { motoMarker.remove(); motoMarker = null; }
  $("origem").value = ""; $("destino").value = ""; $("origem").dataset.escolhido = ""; $("destino").dataset.escolhido = "";
  telaSobre("pedido", false); irAba("home"); carregarHistorico();
}

// Compartilhar rastreio (WhatsApp): status, motoboy, código e link do mapa com a posição atual.
function compartilharWhats() {
  if (!pedido) return;
  let t = `🛵 *É-Já* — entrega a caminho!\nDe: ${pedido.retirada}\nPara: ${pedido.entrega}`;
  if (pedido.moto) t += `\nMotoboy: ${pedido.moto}`;
  if (pedido.codigo) t += `\nCódigo para receber: *${pedido.codigo}*`;
  if (pedido.motoPos) t += `\nOnde está agora: https://maps.google.com/?q=${pedido.motoPos[0].toFixed(5)},${pedido.motoPos[1].toFixed(5)}`;
  window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank");
}

// Avaliação do motoboy
function montarAvaliacao() {
  show("avaliar", true);
  const el = $("estrelas"); el.textContent = "";
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement("button"); b.textContent = "★"; b.type = "button";
    b.onclick = async () => {
      [...el.children].forEach((x, i) => x.classList.toggle("on", i < n));
      const { data } = await db.rpc("avaliar_pedido", { p_id: pedido.id, p_nota: n });
      $("avaliarMsg").textContent = data ? "Obrigado pela avaliação! 🧡" : "Não foi possível avaliar.";
    };
    el.append(b);
  }
}

// ---------- Atividade (histórico) ----------
async function carregarHistorico() {
  const { data } = await db.rpc("meus_pedidos");
  historico = data || []; montarLugares();
  const el = $("listaAtividade"); el.textContent = "";
  if (!historico.length) { el.innerHTML = '<p class="small" style="padding:8px 4px">Você ainda não fez entregas. Toque em <b>Início → Para onde?</b> para começar.</p>'; return; }
  const nomes = { procurando: "Procurando motoboy", aceito: "Motoboy a caminho", coletado: "Em entrega", entregue: "Entregue", cancelado: "Cancelado" };
  historico.forEach(p => {
    const b = itemLugar(p.status === "entregue" ? "✅" : p.status === "cancelado" ? "✖" : "🛵", p.entrega.split(" · ")[0],
      new Date(p.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " + nomes[p.status] + (p.nota ? " · " + "★".repeat(p.nota) : ""),
      async () => {
        if (["procurando", "aceito", "coletado"].includes(p.status)) { const { data } = await db.rpc("meu_pedido_ativo"); if (data && data[0]) mostrarPedido(data[0]); }
        else toast(p.retirada + " → " + p.entrega + " · " + money(p.preco), 4000);
      });
    b.querySelector("em").textContent = money(p.preco);
    el.append(b);
  });
}

setInterval(atualizarStatus, 10000);
