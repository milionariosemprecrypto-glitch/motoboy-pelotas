// É-Já Motoboy: cadastro com documentos, aprovação e corridas.
let usuario = null, aprovado = false;
let disponivel = false, ocupado = false, ofertaAtual = null, corrida = null;
let timerOferta = null, timerMoto = null, motoAbaAtual = "inicio", mapa = null, marcador = null, ultimaPos = null;
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
  if (a === "ganhos") carregarGanhos(); else setTimeout(() => mapa && mapa.invalidateSize(), 60);
  atualizarBarra();
}

function iniciarMapa() {
  if (mapa) return;
  document.body.classList.add("modo-mapa");
  mapa = criarMapa("mapa");
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    ultimaPos = ll;
    if (!marcador) {
      marcador = L.marker(ll, { icon: icone.moto(), zIndexOffset: 1000 }).addTo(mapa);
      mapa.setView(ll, 15);
    } else marcador.setLatLng(ll);
  }, () => {}, { enableHighAccuracy: true });
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
    }, (loc, err) => { if (loc) { ultimaPos = [loc.latitude, loc.longitude]; marcador && marcador.setLatLng(ultimaPos); } });
  } else if (!ligar && watcherBg) { await BG.removeWatcher({ id: watcherBg }); watcherBg = null; }
}

function centralizar() { if (ultimaPos) mapa.setView(ultimaPos, 16); else mapa.setView(PELOTAS, 14); }

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
  $("ofertaResumo").textContent = "Retirada: " + o.retirada + " | Entrega: " + o.entrega + " | Item: " + o.item +
    " | " + Number(o.distancia_km).toLocaleString("pt-BR") + " km";
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

let camadasCorrida = [];
async function desenharCorrida(c) {
  camadasCorrida.forEach(x => x.remove()); camadasCorrida = [];
  if (!c || c.ret_lat == null) return;
  const alvo = c.status === "aceito" ? { lat: c.ret_lat, lng: c.ret_lng } : { lat: c.ent_lat, lng: c.ent_lng };
  camadasCorrida.push(L.marker([alvo.lat, alvo.lng], { icon: c.status === "aceito" ? icone.retirada() : icone.entrega() }).addTo(mapa));
  if (ultimaPos) {
    const r = await calcularRota({ lat: ultimaPos[0], lng: ultimaPos[1] }, alvo);
    if (r) { camadasCorrida.push(L.polyline(r.linha, ROTA).addTo(mapa)); mapa.fitBounds(r.linha, { padding: [30, 30] }); }
  }
}

function abrirNavegacao() {
  const c = corrida; if (!c) return;
  const [lat, lng] = c.status === "aceito" ? [c.ret_lat, c.ret_lng] : [c.ent_lat, c.ent_lng];
  window.open("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + lat + "," + lng, "_blank");
}

function mostrarCorrida() {
  const c = corrida, coletando = c.status === "aceito";
  desenharCorrida(c); localizacaoSegundoPlano(true); enviarLocal(true);
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
  corrida = null; ocupado = false; desenharCorrida(null);
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
