// É-Já Motoboy: cadastro com documentos, aprovação e corridas.
let usuario = null, aprovado = false;
let disponivel = false, ocupado = false, ofertaAtual = null, corrida = null;
let timerOferta = null, timerMoto = null, motoAbaAtual = "inicio", mapa = null, marcador = null, ultimaPos = null;
const recusados = new Set();

iniciarAuth({ role: "motoboy", aoEntrar: u => { usuario = u; carregar(); } });

// ---------- cadastro / aprovação ----------
async function carregar() {
  ["telaCadastro", "telaAguardando", "telaBloqueado", "telaTrabalho"].forEach(t => show(t, false));
  const { data: m } = await db.from("motoboys").select("*").maybeSingle();
  const { data: p } = await db.from("profiles").select("nome, telefone").maybeSingle();
  if (!m) { $("telaBloqueado").querySelector("p").textContent = "Esta conta é de cliente. Use o app É-Já."; show("telaBloqueado", true); return; }
  if (p) { $("cNome").value = p.nome || ""; $("cTel").value = p.telefone || ""; }
  if (m.status === "bloqueado") show("telaBloqueado", true);
  else if (m.status === "aprovado") { aprovado = true; show("telaTrabalho", true); iniciarMapa(); sincronizar(); }
  else if (!m.enviado_em) show("telaCadastro", true);
  else show("telaAguardando", true);
  atualizarBarra();
}

async function enviarArquivo(input, nome) {
  const f = input.files[0];
  if (f.size > 5 * 1024 * 1024) throw new Error("Arquivo muito grande (máx. 5 MB).");
  const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
  const caminho = usuario.id + "/" + nome + "." + ext;   // pasta = id do usuário (exigido pelo RLS)
  const { error } = await db.storage.from("motoboy-docs").upload(caminho, f, { upsert: true, contentType: f.type });
  if (error) throw error;
  return caminho;
}

$("cadForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const cpf = $("cCpf").value.replace(/\D/g, "");
  if (cpf.length !== 11) { $("cadMsg").textContent = "CPF deve ter 11 números."; return; }
  $("cadBtn").disabled = true; $("cadMsg").textContent = "Enviando…";
  try {
    const foto = await enviarArquivo($("cFoto"), "foto");
    const doc = await enviarArquivo($("cDoc"), "cnh");
    const { error } = await db.rpc("enviar_cadastro_motoboy", {
      p_nome: $("cNome").value, p_telefone: $("cTel").value, p_cpf: cpf, p_cnh: $("cCnh").value,
      p_placa: $("cPlaca").value, p_modelo: $("cModelo").value, p_foto_path: foto, p_doc_path: doc
    });
    if (error) throw error;
    $("cadMsg").textContent = "";
    carregar();
  } catch (e) { $("cadMsg").textContent = "Erro: " + erroMsg(e); }
  finally { $("cadBtn").disabled = false; }
});

// ---------- trabalho ----------
function atualizarBarra() {
  show("motoBar", aprovado && motoAbaAtual === "inicio" && !ocupado && !!usuario);
}

function motoAba(a) {
  motoAbaAtual = a;
  show("motoInicio", a === "inicio"); show("motoGanhos", a === "ganhos");
  $("segInicio").classList.toggle("active", a === "inicio");
  $("segGanhos").classList.toggle("active", a === "ganhos");
  if (a === "ganhos") carregarGanhos(); else setTimeout(() => mapa && mapa.invalidateSize(), 60);
  atualizarBarra();
}

function iniciarMapa() {
  if (mapa) return;
  mapa = L.map("mapa", { zoomControl: false }).setView(PELOTAS, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
  setTimeout(() => mapa.invalidateSize(), 100);
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    ultimaPos = ll;
    if (!marcador) {
      marcador = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#087e67", fillOpacity: 1 }).addTo(mapa);
      mapa.setView(ll, 15);
    } else marcador.setLatLng(ll);
  }, () => {}, { enableHighAccuracy: true });
}

// Envia a localização ao servidor a cada 15 s enquanto online (base para o rastreio ao vivo da Fase 2).
setInterval(() => {
  if (aprovado && ultimaPos && (disponivel || ocupado))
    db.rpc("atualizar_local", { p_lat: ultimaPos[0], p_lng: ultimaPos[1], p_online: true });
}, 15000);

function alternarDisponibilidade() {
  disponivel = !disponivel;
  $("disponivel").textContent = disponivel ? "Ficar offline" : "Ficar online";
  $("disponivel").classList.toggle("off", disponivel);
  $("motoStatus").textContent = disponivel ? "Você está online. Procurando corridas…" : "Você está offline.";
  if (ultimaPos) db.rpc("atualizar_local", { p_lat: ultimaPos[0], p_lng: ultimaPos[1], p_online: disponivel });
  clearInterval(timerMoto);
  if (disponivel) { buscarOfertas(); timerMoto = setInterval(buscarOfertas, 4000); }
  else esconderOferta();
}

function mostrarOferta(o) {
  ofertaAtual = o;
  $("ofertaPreco").textContent = money(o.preco);
  $("ofertaResumo").textContent = "Retirada: " + o.retirada + " | Entrega: " + o.entrega + " | Item: " + o.item +
    " | " + Number(o.distancia_km).toLocaleString("pt-BR") + " km";
  const b = $("barraTempo");
  b.style.transition = "none"; b.style.width = "100%"; void b.offsetWidth;
  b.style.transition = "width 30s linear"; b.style.width = "0%";
  clearTimeout(timerOferta);
  timerOferta = setTimeout(recusarCorrida, 30000);
  show("oferta", true);
}

function esconderOferta() { clearTimeout(timerOferta); ofertaAtual = null; show("oferta", false); }

async function buscarOfertas() {
  if (!disponivel || ocupado) return;
  const { data, error } = await db.rpc("pedidos_abertos");
  if (error) return;
  const o = (data || []).find(x => !recusados.has(x.id)) || null;
  if (!o) return esconderOferta();
  if (!ofertaAtual || ofertaAtual.id !== o.id) mostrarOferta(o);
}

async function aceitarCorrida() {
  const o = ofertaAtual;
  if (!o) return;
  const { data, error } = await db.rpc("aceitar_pedido", { p_id: o.id });
  if (error) { alert("Não foi possível aceitar: " + erroMsg(error)); return; }
  esconderOferta();
  if (data) { corrida = { ...o, status: "aceito" }; ocupado = true; mostrarCorrida(); }
  else { recusados.add(o.id); $("motoStatus").textContent = "Outro motoboy aceitou antes de você."; buscarOfertas(); }
}

function recusarCorrida() {
  if (ofertaAtual) recusados.add(ofertaAtual.id);
  esconderOferta();
  buscarOfertas();
}

function mostrarCorrida() {
  const c = corrida, coletando = c.status === "aceito";
  show("corrida", true);
  $("corridaTitulo").textContent = coletando ? "Vá retirar o item" : "Leve até o destino";
  $("corridaInfo").textContent = (coletando ? "Retirada: " + c.retirada : "Entrega: " + c.entrega) +
    " | Item: " + c.item + " | Valor: " + money(c.preco);
  show("codigoLabel", !coletando); show("codigoEntrega", !coletando);
  $("corridaBtn").textContent = coletando ? "Já coletei o item" : "Concluir entrega";
  $("motoStatus").textContent = coletando ? "Corrida aceita. Siga até o local de retirada." : "Item coletado. Siga até o destino.";
  atualizarBarra();
}

function encerrarCorrida(msg) {
  corrida = null; ocupado = false;
  show("corrida", false);
  $("codigoEntrega").value = "";
  $("motoStatus").textContent = msg;
  atualizarBarra();
  buscarOfertas();
}

async function avancar() {
  const c = corrida;
  if (!c) return;
  const { data, error } = await db.rpc("avancar_pedido", { p_id: c.id, p_codigo: $("codigoEntrega").value.trim() });
  if (error) { alert("Não foi possível atualizar: " + erroMsg(error)); return; }
  if (data === "coletado") { c.status = "coletado"; mostrarCorrida(); }
  else if (data === "entregue") encerrarCorrida("Entrega concluída! Veja em Ganhos.");
  else if (data === "codigo_errado") alert("Código incorreto. Peça ao destinatário o código de 4 dígitos.");
  else encerrarCorrida("Esta corrida foi cancelada.");
}

// Recupera a corrida ao reabrir o app e percebe se o cliente cancelou.
async function sincronizar() {
  if (!aprovado) return;
  const { data, error } = await db.rpc("minha_corrida");
  if (error) return;
  const c = data && data[0];
  if (c) { corrida = c; ocupado = true; mostrarCorrida(); }
  else if (corrida) encerrarCorrida("O cliente cancelou a corrida.");
}
setInterval(sincronizar, 5000);

async function carregarGanhos() {
  const lista = $("ganhosLista");
  lista.textContent = "";
  const { data, error } = await db.rpc("ganhos");
  if (error) { $("ganhosResumo").textContent = "Não foi possível carregar agora."; return; }
  const todas = data || [], hoje = new Date().toDateString();
  const dia = todas.filter(g => new Date(g.entregue_em).toDateString() === hoje);
  const soma = a => a.reduce((s, g) => s + Number(g.preco), 0);
  $("ganhosTotal").textContent = money(soma(dia));
  $("ganhosResumo").textContent = dia.length + " entrega(s) hoje | " + todas.length + " no total (" + money(soma(todas)) + ")";
  todas.forEach(g => {
    const linha = document.createElement("div"); linha.className = "corrida-item";
    const t = document.createElement("span"); t.textContent = g.retirada + " → " + g.entrega;
    const v = document.createElement("strong"); v.textContent = money(g.preco);
    linha.append(t, v); lista.append(linha);
  });
}
