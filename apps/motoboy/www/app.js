// É-Já Motoboy: cadastro com documentos, aprovação e corridas.
let usuario = null, aprovado = false;
let disponivel = false, ocupado = false, ofertaAtual = null, corrida = null;
let timerOferta = null, timerMoto = null, motoAbaAtual = "inicio", mapa = null, marcador = null, ultimaPos = null;
let seguirMoto = true, vozLigada = false, ultimoPan = 0, navBuscando = false;
try { vozLigada = localStorage.getItem("eja_nav_voz") === "1"; } catch (e) {}
const recusados = new Set();

iniciarAuth({ role: "motoboy", aoEntrar: u => { usuario = u; carregar(); } });

// ---------- cadastro / aprovação ----------
async function carregar() {
  ["telaCadastro", "telaAguardando", "telaBloqueado", "telaTrabalho"].forEach(t => show(t, false));
  const { data: m } = await db.from("motoboys").select("*").eq("id", usuario.id).maybeSingle();
  const { data: p } = await db.from("profiles").select("nome, telefone").eq("id", usuario.id).maybeSingle();
  if (!m) { $("telaBloqueado").querySelector("p").textContent = "Esta conta é de cliente. Use o app É-Já."; show("telaBloqueado", true); return; }
  if (p) { $("cNome").value = p.nome || ""; $("cTel").value = p.telefone || ""; }
  if (m.status === "bloqueado" || m.status === "reprovado") await mostrarSituacao(m.status);
  else if (m.status === "aprovado") {
    aprovado = true; show("telaTrabalho", true); iniciarMapa(); sincronizar(); carregarGanhos();
    iniciarPush("motoboy", d => { if (d.tipo === "nova_corrida" && !disponivel) alternarDisponibilidade(); else buscarOfertas(); });
  }
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
  const anos = d => (Date.now() - new Date(d + "T12:00:00")) / (365.25 * 864e5);
  if (anos($("cNasc").value) < 21) { $("cadMsg").textContent = "Motofrete exige 21 anos ou mais (Lei 12.009/2009)."; return; }
  if (!/A/.test($("cCat").value)) { $("cadMsg").textContent = "A CNH precisa ter categoria A."; return; }
  if (anos($("cPrimHab").value) < 2) { $("cadMsg").textContent = "É preciso ter CNH categoria A há pelo menos 2 anos."; return; }
  if (new Date($("cValidade").value + "T23:59:59") < new Date()) { $("cadMsg").textContent = "Sua CNH está vencida."; return; }
  if ($("cAnt").files[0] && !$("cAntConsent").checked) { $("cadMsg").textContent = "Para enviar a certidão, marque a autorização."; return; }
  $("cadBtn").disabled = true; $("cadMsg").textContent = "Enviando…";
  try {
    const foto = await enviarArquivo($("cFoto"), "foto");
    const doc = await enviarArquivo($("cDoc"), "cnh");
    const curso = await enviarArquivo($("cCurso"), "curso");
    const ant = $("cAnt").files[0] ? await enviarArquivo($("cAnt"), "antecedentes") : null;
    const { error } = await db.rpc("enviar_cadastro_motoboy", {
      p_nome: $("cNome").value, p_telefone: $("cTel").value, p_cpf: cpf, p_cnh: $("cCnh").value,
      p_placa: $("cPlaca").value, p_modelo: $("cModelo").value, p_foto_path: foto, p_doc_path: doc,
      p_nascimento: $("cNasc").value, p_cnh_categoria: $("cCat").value, p_cnh_primeira_hab: $("cPrimHab").value,
      p_cnh_validade: $("cValidade").value, p_curso_path: curso, p_antecedentes_path: ant, p_consentimento_antecedentes: $("cAntConsent").checked
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
  if (aprovado) atualizarPainel();
}

function motoAba(a) {
  motoAbaAtual = a;
  show("motoInicio", a === "inicio"); show("motoGanhos", a === "ganhos");
  $("segInicio").classList.toggle("active", a === "inicio");
  $("segGanhos").classList.toggle("active", a === "ganhos");
  const folha = document.querySelector("#telaTrabalho .painel");
  if (a === "ganhos") { carregarGanhos(); folhaIr(folha, 2); }
  else { folhaIr(folha, 0); setTimeout(() => mapa && ajustarMapa(mapa), 80); }
  atualizarBarra();
}

function iniciarMapa() {
  if (mapa) return;
  document.body.classList.add("modo-mapa");
  mapa = criarMapa("mapa", { pitch: 55, zoom: 15 });
  ligarFolha(document.querySelector("#telaTrabalho .painel"), {
    inicial: 0,
    colapsada: () => document.body.classList.contains("em-corrida") ? 0 : 148
  });
  if ($("navVoz")) $("navVoz").textContent = vozLigada ? "Voz on" : "Voz off";
  mapa.on("dragstart", () => { seguirMoto = false; document.body.classList.add("mapa-livre"); });
  mapa.on("move", () => { if (marcador) orientarMarcador(marcador, Nav.ultimoRumo, mapa.getBearing()); });
  window.addEventListener("eja-folha", ev => {
    if (seguirMoto && ultimaPos) aplicarCamera(ultimaPos[0], ultimaPos[1], Nav.ultimoRumo, 0, ev.detail && ev.detail.arrastando ? 0 : 400);
  });
  if (!navigator.geolocation) { if ($("motoStatus")) $("motoStatus").textContent = "GPS indisponível neste aparelho."; return; }
  navigator.geolocation.watchPosition(p => {
    aoPosicao(p.coords.latitude, p.coords.longitude, p.coords.heading, p.coords.speed);
  }, avisoGps, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}
function avisoGps(err) {
  const code = err && err.code;
  const msg = String((err && (err.message || err.code)) || "");
  const negado = code === 1 || /denied|permission/i.test(msg);
  const tempo = code === 3 || /timeout/i.test(msg);
  const texto = negado ? "Permissão de localização negada. Ative o GPS para o É-Já."
    : tempo ? "Tempo esgotado ao buscar o GPS."
    : "Não foi possível ler o GPS.";
  if ($("motoStatus")) $("motoStatus").textContent = texto;
}

// Envia a localização: a cada 10 s em corrida (rastreio ao vivo do cliente), 30 s quando só online.
let ultimoEnvio = 0;
function enviarLocal(forcar) {
  if (!aprovado || !ultimaPos || !(disponivel || ocupado)) return;
  const intervalo = ocupado ? 10000 : 30000;
  if (!forcar && Date.now() - ultimoEnvio < intervalo) return;
  ultimoEnvio = Date.now();
  db.rpc("atualizar_local", { p_lat: ultimaPos[0], p_lng: ultimaPos[1], p_online: disponivel || ocupado }).then(() => {}); // .then() dispara a chamada (o supabase-js só envia quando "aguardado")
}
setInterval(enviarLocal, 2000);

// No Android, usa serviço em primeiro plano (notificação fixa) para continuar enviando com a tela apagada.
let watcherBg = null;
async function localizacaoSegundoPlano(ligar) {
  const C = window.Capacitor, BG = C && C.isNativePlatform && C.isNativePlatform() && C.Plugins.BackgroundGeolocation;
  if (!BG) return;
  if (ligar && !watcherBg) {
    watcherBg = await BG.addWatcher({
      backgroundTitle: "É-Já Motoboy", backgroundMessage: "Compartilhando sua localização durante o trabalho",
      requestPermissions: true, stale: false, distanceFilter: 15
    }, (loc, err) => { if (err) avisoGps(err); if (loc) aoPosicao(loc.latitude, loc.longitude, loc.bearing, loc.speed); });
  } else if (!ligar && watcherBg) { await BG.removeWatcher({ id: watcherBg }); watcherBg = null; }
}

let rumoParaCima = true;
function zoomPorVelocidade(speed) {
  if (!ocupado) return 16.4;
  const v = speed == null ? 0 : speed;
  if (v < 1.5) return 17;
  if (v < 6) return 16.4;
  if (v < 12) return 15.8;
  return 15.2;
}
function paddingCamera() {
  const folha = document.querySelector("#telaTrabalho .painel");
  const H = window.innerHeight || 700;
  const h = folha ? (parseFloat(folha.style.height) || folha.getBoundingClientRect().height || 148) : 148;
  let bottom = Math.max(0, h) + 28;
  const top = document.body.classList.contains("em-corrida") ? 108 : 72;
  if (top + bottom > H - 96) bottom = Math.max(48, H - 96 - top);
  return { top, bottom, left: 28, right: 72 };
}
function aplicarCamera(lat, lng, bearing, speed, duracao) {
  if (!mapa || !seguirMoto || !mapa.easePara) return;
  const b = rumoParaCima ? (bearing || 0) : 0;
  mapa.easePara({ lat, lng, bearing: b, pitch: 55, zoom: zoomPorVelocidade(speed), padding: paddingCamera(), duration: duracao == null ? 750 : duracao });
  orientarMarcador(marcador, bearing || 0, b);
}
function alternarBussola() {
  rumoParaCima = !rumoParaCima;
  const btn = $("bussola");
  if (btn) { btn.classList.toggle("norte", !rumoParaCima); btn.querySelector("b").textContent = rumoParaCima ? "↑" : "N"; }
  if (seguirMoto && ultimaPos) aplicarCamera(ultimaPos[0], ultimaPos[1], Nav.ultimoRumo, 0);
  else if (mapa && mapa.easePara && mapa.getCenter) {
    const c = mapa.getCenter();
    mapa.easePara({ lat: c.lat, lng: c.lng, bearing: rumoParaCima ? (Nav.ultimoRumo || 0) : 0, pitch: 55, zoom: mapa.getZoom(), duration: 450 });
  }
}
function centralizar() {
  seguirMoto = true;
  document.body.classList.remove("mapa-livre");
  if (ultimaPos) aplicarCamera(ultimaPos[0], ultimaPos[1], Nav.ultimoRumo, 0);
  else if (mapa) mapa.setView(PELOTAS, 14);
}

function atualizarPainel() {
  $("motoStatusTitulo").textContent = ocupado ? "Em corrida" : disponivel ? "Procurando corridas" : "Você está offline";
  show("barraBusca", disponivel && !ocupado);
  $("disponivel").innerHTML = disponivel ? "✋" : "FICAR<br>ONLINE";
  $("disponivel").classList.toggle("off", disponivel);
  show("rotuloOffline", disponivel);
  document.body.classList.toggle("em-corrida", ocupado);
}

function alternarDisponibilidade() {
  disponivel = !disponivel;
  $("motoStatus").textContent = disponivel ? "Você está online. Procurando corridas…" : "Você está offline.";
  atualizarPainel();
  localizacaoSegundoPlano(disponivel || ocupado);
  if (ultimaPos) db.rpc("atualizar_local", { p_lat: ultimaPos[0], p_lng: ultimaPos[1], p_online: disponivel }).then(() => {});
  clearInterval(timerMoto);
  if (disponivel) { buscarOfertas(); timerMoto = setInterval(buscarOfertas, 4000); }
  else esconderOferta();
}

function mostrarOferta(o) {
  ofertaAtual = o;
  $("ofertaPreco").textContent = money(o.preco);
  $("ofertaResumo").textContent = "Retirada: " + textoEndereco(o.retirada, o.ret_numero, o.ret_complemento) +
    " | Entrega: " + textoEndereco(o.entrega, o.ent_numero, o.ent_complemento) +
    " | Item: " + o.item + " | " + Number(o.distancia_km).toLocaleString("pt-BR") + " km";
  const b = $("barraTempo");
  b.style.transition = "none"; b.style.width = "100%"; void b.offsetWidth;
  b.style.transition = "width 30s linear"; b.style.width = "0%";
  clearTimeout(timerOferta);
  timerOferta = setTimeout(recusarCorrida, 30000);
  show("oferta", true);
  Alerta.tocarChamada();   // toque em loop + vibração até aceitar/recusar/30 s
}

function esconderOferta() { clearTimeout(timerOferta); Alerta.parar(); ofertaAtual = null; show("oferta", false); }

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
  if (data) { ocupado = true; await sincronizar(); }
  else { recusados.add(o.id); $("motoStatus").textContent = "Outro motoboy aceitou antes de você."; buscarOfertas(); }
}

function recusarCorrida() {
  if (ofertaAtual) recusados.add(ofertaAtual.id);
  esconderOferta();
  buscarOfertas();
}

let linhaNav = null, marcaAlvo = null, alvoDesenhado = null;
function alvoCorrida() {
  const c = corrida;
  if (!c || c.ret_lat == null) return null;
  return c.status === "aceito"
    ? { lat: c.ret_lat, lng: c.ret_lng, key: c.id + ":ret" }
    : { lat: c.ent_lat, lng: c.ent_lng, key: c.id + ":ent" };
}
function limparDesenhoNav() {
  if (linhaNav) { linhaNav.remove(); linhaNav = null; }
  if (marcaAlvo) { marcaAlvo.remove(); marcaAlvo = null; }
  alvoDesenhado = null;
}
function desenharAlvo() {
  const alvo = alvoCorrida();
  if (!alvo || !mapa) return;
  if (alvoDesenhado === alvo.key && marcaAlvo) return;
  if (marcaAlvo) marcaAlvo.remove();
  marcaAlvo = colocarMarcador(mapa, alvo.lat, alvo.lng, htmlAlvo(corrida.status === "aceito"));
  alvoDesenhado = alvo.key;
}
function desenharLinhaNav() {
  if (!mapa) return;
  if (linhaNav) { linhaNav.remove(); linhaNav = null; }
  if (Nav.rota) linhaNav = colocarLinha(mapa, Nav.rota.linha, ROTA);
}
function preencherLugar(c) {
  const coleta = c.status === "aceito";
  $("lugarRotulo").textContent = coleta ? "Buscar em" : "Entregar em";
  $("lugarRua").textContent = coleta ? c.retirada : c.entrega;
  const num = coleta ? c.ret_numero : c.ent_numero;
  const comp = coleta ? c.ret_complemento : c.ent_complemento;
  const el = $("lugarNum");
  if (num) { el.textContent = num === "S/N" ? "S/N" : "nº " + num; el.classList.remove("vazio"); }
  else { el.textContent = "Sem número neste pedido"; el.classList.add("vazio"); }
  $("lugarComp").textContent = comp || "";
  show("lugarComp", !!comp);
}
function esconderNav() {
  show("navBanner", false); show("navEta", false);
  NavLimpar(); limparDesenhoNav();
}
function renderNav(lat, lng) {
  show("navBanner", true); show("navEta", true);
  const alvo = alvoCorrida();
  const p = (Nav.rota && alvo && Nav.rota.alvoKey === alvo.key) ? painelNav(lat, lng) : null;
  if (!p) {
    $("navSeta").textContent = "…";
    $("navInstrucao").textContent = Nav.falhou ? "Sem rota agora. Use Google Maps ou Waze." : "Traçando a rota…";
    $("navRua").textContent = "";
    $("navDist").textContent = "—";
    $("navTempo").textContent = "";
    return;
  }
  $("navSeta").textContent = p.seta;
  $("navInstrucao").textContent = textoManobra(p.instrucao, p.metrosManobra, p.tipo);
  $("navRua").textContent = p.fora ? "Você saiu da rota. Recalculando…" : (p.nome || "");
  $("navDist").textContent = formatarDistancia(p.restanteM);
  $("navTempo").textContent = formatarDuracao(p.restanteS);
  if (p.voz && p.voz !== Nav.ultimaVoz) { Nav.ultimaVoz = p.voz; falarNav(p.voz); }
}
function falarNav(texto) {
  if (!vozLigada || !texto || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "pt-BR";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}
function alternarVoz() {
  vozLigada = !vozLigada;
  try { localStorage.setItem("eja_nav_voz", vozLigada ? "1" : "0"); } catch (e) {}
  $("navVoz").textContent = vozLigada ? "Voz on" : "Voz off";
  if (!vozLigada && window.speechSynthesis) { speechSynthesis.cancel(); Nav.ultimaVoz = ""; return; }
  falarNav("Voz ligada");
  Nav.ultimaVoz = "";
}
function escolherRumo(anterior, atual, heading, speed) {
  if (typeof heading === "number" && !Number.isNaN(heading) && heading >= 0 && (speed == null || speed > 0.4)) return heading;
  if (anterior && metrosEntre(anterior, atual) > 8) return rumoGraus(anterior, atual);
  return Nav.ultimoRumo;
}
async function aoPosicao(lat, lng, heading, speed) {
  const anterior = ultimaPos ? { lat: ultimaPos[0], lng: ultimaPos[1] } : null;
  const ll = [lat, lng];
  ultimaPos = ll;
  if (mapa) {
    if (!marcador) marcador = colocarMarcador(mapa, lat, lng, htmlMoto());
    else marcador.setLatLng(ll);
  }
  const rumo = escolherRumo(anterior, { lat, lng }, heading, speed);
  if (rumo != null) Nav.ultimoRumo = rumo;
  const seguirCamera = () => {
    if (seguirMoto && mapa && Date.now() - ultimoPan > 600) {
      ultimoPan = Date.now();
      aplicarCamera(lat, lng, Nav.ultimoRumo, speed);
    } else orientarMarcador(marcador, Nav.ultimoRumo, mapa && mapa.getBearing ? mapa.getBearing() : 0);
  };
  if (!ocupado || !corrida) { seguirCamera(); return; }
  const alvo = alvoCorrida();
  if (!alvo) return;
  desenharAlvo();
  const precisa = precisaRotaNav(lat, lng, alvo.key);
  if (precisa.buscar && !navBuscando) {
    navBuscando = true;
    const res = await buscarRotaNav({ lat, lng }, alvo, { forcar: precisa.forcar });
    navBuscando = false;
    if (res && res.rota) { definirRotaNav(res.rota, alvo.key); desenharLinhaNav(); }
    else if (res && !res.throttled && !Nav.rota) Nav.falhou = true;
  }
  renderNav(lat, lng);
  seguirCamera();
}

function abrirNavegacao(app) {
  const alvo = alvoCorrida(); if (!alvo) return;
  const url = urlMapaExterno(app === "waze" ? "waze" : "google", alvo.lat, alvo.lng);
  if (url) window.open(url, "_blank");
}

function mostrarCorrida() {
  const c = corrida, coletando = c.status === "aceito";
  seguirMoto = true;
  document.body.classList.add("em-corrida");
  if (mapa && ultimaPos) aplicarCamera(ultimaPos[0], ultimaPos[1], Nav.ultimoRumo, 1);
  desenharAlvo();
  if (ultimaPos) aoPosicao(ultimaPos[0], ultimaPos[1], Nav.ultimoRumo, 1);
  else renderNav(PELOTAS[0], PELOTAS[1]);
  localizacaoSegundoPlano(true); enviarLocal(true);
  show("corrida", true);
  $("corridaTitulo").textContent = coletando ? "Vá retirar o item" : "Leve até o destino";
  preencherLugar(c);
  $("corridaInfo").textContent = "Item: " + c.item + " | Valor: " + money(c.preco);
  show("codigoLabel", !coletando); show("codigoEntrega", !coletando);
  $("corridaBtn").textContent = coletando ? "Já coletei o item" : "Concluir entrega";
  $("motoStatus").textContent = coletando ? "Corrida aceita. Siga até o local de retirada." : "Item coletado. Siga até o destino.";
  folhaIr(document.querySelector("#telaTrabalho .painel"), 0);
  atualizarBarra();
  sincronizarChatMoto();
}

function sincronizarChatMoto() {
  if (!corrida || !usuario) { Chat.parar(); return; }
  Chat.ligar({ pedidoId: corrida.id, meuId: usuario.id, status: corrida.status, outro: "Cliente" });
}

function encerrarCorrida(msg) {
  corrida = null; ocupado = false; esconderNav();
  Chat.parar();
  if (!disponivel) localizacaoSegundoPlano(false);
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
  if (c) { const mudou = !corrida || corrida.id !== c.id || corrida.status !== c.status; corrida = c; ocupado = true; if (mudou) mostrarCorrida(); }
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
  $("pillValor").textContent = Number(soma(dia)).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  $("ganhosResumo").textContent = dia.length + " entrega(s) hoje | " + todas.length + " no total (" + money(soma(todas)) + ")";
  todas.forEach(g => {
    const linha = document.createElement("div"); linha.className = "corrida-item";
    const t = document.createElement("span"); t.textContent = g.retirada + " → " + g.entrega;
    const v = document.createElement("strong"); v.textContent = money(g.preco);
    linha.append(t, v); lista.append(linha);
  });
}

// ---------- Suspensão / reprovação: motivo e contestação (devido processo) ----------
async function mostrarSituacao(status) {
  const { data } = await db.rpc("minha_situacao");
  const s = (data && data[0]) || {};
  $("bloqTag").textContent = status === "reprovado" ? "Cadastro não aprovado" : "Conta suspensa";
  $("bloqTitulo").textContent = status === "reprovado" ? "Seu cadastro não foi aprovado" : "Sua conta está suspensa";
  $("bloqMotivo").textContent = s.motivo || "Motivo não informado. Use a contestação abaixo.";
  $("bloqData").textContent = s.status_em ? "Decisão em " + new Date(s.status_em).toLocaleString("pt-BR") : "";
  show("btnCorrigirReprov", status === "reprovado");
  const aberta = s.contestacao_situacao === "aberta";
  show("contestacaoInfo", !!s.contestacao_situacao);
  if (s.contestacao_situacao) $("contestacaoInfo").textContent = aberta
    ? "Sua contestação foi recebida em " + new Date(s.contestacao_em).toLocaleDateString("pt-BR") + " e está em análise (até 7 dias)."
    : "Contestação " + s.contestacao_situacao + ": " + (s.contestacao_resposta || "");
  show("contestarBox", !aberta);
  show("telaBloqueado", true);
}
async function contestar() {
  const t = $("contestarTexto").value.trim();
  if (t.length < 10) { $("contestarMsg").textContent = "Escreva pelo menos 10 caracteres."; return; }
  $("btnContestar").disabled = true;
  const { error } = await db.rpc("contestar_status", { p_texto: t });
  $("btnContestar").disabled = false;
  if (error) { $("contestarMsg").textContent = erroMsg(error); return; }
  $("contestarTexto").value = ""; $("contestarMsg").textContent = "";
  carregar();
}
