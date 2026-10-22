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
  ligarBusca();
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
  if (a === "conta") {
    const casa = guardar.ler("casa"), trab = guardar.ler("trabalho");
    $("contaCasa").textContent = casa ? textoEndereco(casa.nome, casa.numero, casa.complemento) : "Adicionar";
    $("contaTrabalho").textContent = trab ? textoEndereco(trab.nome, trab.numero, trab.complemento) : "Adicionar";
  }
  window.scrollTo(0, 0);
}
const telaSobre = (id, on) => {
  show(id, on);
  document.body.classList.toggle("sem-nav", !!document.querySelector(".tela.sobre:not(.hidden)"));
  document.documentElement.classList.toggle("plano-aberto", !!($("telaPlano") && !$("telaPlano").classList.contains("hidden")));
};

// ---------- Localização atual ----------
function atualizarLocal(avisar) {
  $("locAtual").textContent = "Buscando localização…";
  if (!navigator.geolocation) {
    $("locAtual").textContent = "GPS indisponível";
    if (avisar) toast("Este aparelho não informou a localização.");
    return;
  }
  navigator.geolocation.getCurrentPosition(async p => {
    aqui = { lat: p.coords.latitude, lng: p.coords.longitude, numero: "S/N", complemento: "" };
    if (!dentroPelotas(aqui.lat, aqui.lng)) {
      $("locAtual").textContent = "Fora de Pelotas";
      if (avisar) toast("Por enquanto atendemos só Pelotas.");
      return;
    }
    const nome = await nomeDoPonto(aqui.lat, aqui.lng, { timeout: 4000 });
    aqui.nome = nome || "Minha localização";
    $("locAtual").textContent = aqui.nome;
    montarLugares();
    pintarPontosAzuis();
    aplicarGpsNoPlano();
  }, err => {
    const negado = err && err.code === 1;
    const tempo = err && err.code === 3;
    $("locAtual").textContent = negado ? "Localização bloqueada" : tempo ? "Tempo esgotado" : "Sem localização";
    if (avisar) toast(negado ? "Permita a localização para usar seu endereço." : tempo ? "O GPS demorou demais. Tente de novo." : "Não foi possível ler a localização.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
}
function abrirMenuLocal() {
  const menu = $("menuLocal");
  const abre = menu.classList.contains("hidden");
  show("menuLocal", abre);
  if (!abre) return;
  atualizarLocal(false);
  const box = $("menuRecentes");
  box.textContent = "";
  sugestoesRecentes().slice(0, 4).forEach(r => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "🕒 " + (r.titulo || r.nome);
    b.onclick = () => { fecharMenuLocal(); escolherDestino(r); };
    box.append(b);
  });
}
function fecharMenuLocal() { show("menuLocal", false); }
function usarGpsComoRetirada() {
  fecharMenuLocal();
  atualizarLocal(true);
  abrirPlano();
  if (aqui && aqui.nome && dentroPelotas(aqui.lat, aqui.lng)) {
    definirLado("origem", { nome: aqui.nome, lat: aqui.lat, lng: aqui.lng, numero: "S/N", tipo: "poi" });
  }
}

// ---------- Início: lugares salvos, recentes, serviços ----------
function recentes() {
  const vistos = new Set(), out = [];
  for (const p of historico) {
    if (!p.ent_lat || vistos.has(p.entrega)) continue;
    vistos.add(p.entrega);
    out.push({ nome: p.entrega, lat: p.ent_lat, lng: p.ent_lng, numero: p.ent_numero || "", complemento: p.ent_complemento || "" });
    if (out.length >= 8) break;
  }
  return out;
}
function recentesLocais() {
  const lista = guardar.ler("recentes_end");
  return Array.isArray(lista) ? lista.filter(e => e && e.nome && e.lat != null) : [];
}
function lembrarRecente(e) {
  if (!e || !e.nome || e.lat == null) return;
  const item = {
    nome: e.nome, lat: e.lat, lng: e.lng, numero: e.numero && e.numero !== "S/N" ? e.numero : "",
    complemento: e.complemento || "", bairro: e.bairro || "", cidade: e.cidade || "Pelotas", uf: e.uf || "RS",
    cep: e.cep || "", tipo: "recente"
  };
  const linhas = linhasEndereco(item);
  item.titulo = linhas.titulo;
  item.subtitulo = linhas.subtitulo;
  const chave = semAcento(item.nome) + "|" + item.numero;
  const lista = recentesLocais().filter(x => semAcento(x.nome) + "|" + (x.numero || "") !== chave);
  lista.unshift(item);
  guardar.gravar("recentes_end", lista.slice(0, 8));
}
function sugestoesRecentes() {
  const vistos = new Set(), out = [];
  function add(e) {
    if (!e || e.lat == null || !e.nome) return;
    const k = semAcento(e.nome) + "|" + (e.numero || "");
    if (vistos.has(k)) return;
    vistos.add(k);
    const linhas = e.titulo ? { titulo: e.titulo, subtitulo: e.subtitulo || "" } : linhasEndereco(e);
    out.push(Object.assign({}, e, { tipo: "recente", titulo: linhas.titulo, subtitulo: linhas.subtitulo || "Pelotas - RS" }));
  }
  recentesLocais().forEach(add);
  recentes().forEach(add);
  return out.slice(0, 8);
}
function ligarBusca() {
  if ($("origem").dataset.busca) return;
  $("origem").dataset.busca = "1";
  autocompletar($("origem"), $("sugOrigem"), e => definirLado("origem", e), t => marcarNoMapa("origem", t), { bias: biasBusca, recentes: sugestoesRecentes });
  autocompletar($("destino"), $("sugDestino"), e => definirLado("destino", e), t => marcarNoMapa("destino", t), { bias: biasBusca, recentes: sugestoesRecentes });
  $("origem").addEventListener("focus", () => focarCampoPlano("origem"));
  $("destino").addEventListener("focus", () => focarCampoPlano("destino"));
  $("origem").addEventListener("input", () => {
    $("origem").dataset.gps = "";
    origemGps = false;
    if ($("origem").dataset.escolhido !== "1") limparDetalhe("origem");
    atualizarLimpar();
  });
  $("destino").addEventListener("input", () => { if ($("destino").dataset.escolhido !== "1") limparDetalhe("destino"); atualizarLimpar(); });
  $("limparOrigem").onclick = () => limparCampo("origem");
  $("limparDestino").onclick = () => limparCampo("destino");
  ["sugOrigem", "sugDestino"].forEach(id => {
    const lista = $(id);
    const input = $(id === "sugOrigem" ? "origem" : "destino");
    if (!lista || lista._ejaObs) return;
    lista._ejaObs = new MutationObserver(() => {
      if (document.activeElement === input) encaixarBusca(input);
    });
    lista._ejaObs.observe(lista, { childList: true });
  });
  ligarSn("origem"); ligarSn("destino");
  atualizarLimpar();
}
// Com o teclado aberto, o campo focado sobe e as sugestões ocupam o que sobrou,
// sem esmagar a altura da caixa da rota.
function listaDoFoco(el) {
  if (!el) return null;
  if (el.id === "origem" || (el.closest && el.closest("#slotOrigem"))) return $("sugOrigem");
  if (el.id === "destino" || (el.closest && el.closest("#slotDestino"))) return $("sugDestino");
  const campo = el.closest && el.closest(".campo");
  return campo ? campo.querySelector(".sugestoes") : null;
}
function focarCampoPlano(lado) {
  const tela = $("telaPlano");
  if (tela) tela.dataset.foco = lado;
  const outra = $(lado === "origem" ? "sugDestino" : "sugOrigem");
  if (outra && document.activeElement === $(lado)) outra.innerHTML = "";
  const campo = $(lado);
  if (campo && campo.value) setTimeout(() => { try { campo.select(); } catch (e) {} }, 0);
  encaixarBusca(campo);
}
// As duas linhas ficam visíveis. As sugestões ocupam o espaço abaixo da caixa, acima do teclado.
function encaixarBusca(el, repetir) {
  const tela = $("telaPlano");
  const rol = tela && tela.querySelector(".plano-rolagem");
  if (!rol || !el || !tela || tela.classList.contains("hidden") || !rol.contains(el)) {
    limitarSugestaoPino();
    return;
  }
  const caixa = tela.querySelector(".caixa-rota");
  const lista = listaDoFoco(el);
  const margem = 8;
  if (caixa) {
    const rr = rol.getBoundingClientRect();
    const cr = caixa.getBoundingClientRect();
    if (cr.top < rr.top + margem) rol.scrollTop -= rr.top + margem - cr.top;
    else if (cr.bottom > rr.bottom - margem && cr.height < rr.height - 24) rol.scrollTop += cr.bottom - (rr.bottom - margem);
  }
  if (lista) {
    const temLista = lista.childElementCount > 0;
    if (!temLista) lista.style.maxHeight = "";
    else if (caixa) {
      const base = caixa.getBoundingClientRect().bottom;
      const fundo = rol.getBoundingClientRect().bottom;
      lista.style.maxHeight = Math.max(120, Math.floor(fundo - base - 8)) + "px";
    }
  }
  limitarSugestaoPino();
  if (repetir !== false) requestAnimationFrame(() => encaixarBusca(el, false));
}
function limitarSugestaoPino() {
  const lista = $("sugPino"), input = $("buscaPino"), tela = $("telaPino");
  if (!lista || !input || !tela || tela.classList.contains("hidden")) return;
  const vv = window.visualViewport;
  const fundo = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const base = input.getBoundingClientRect().bottom;
  lista.style.maxHeight = Math.max(96, Math.floor(fundo - base - 16)) + "px";
}
window.encaixarBusca = encaixarBusca;
function biasBusca() {
  if (aqui && dentroPelotas(aqui.lat, aqui.lng)) return [aqui.lat, aqui.lng];
  return null;
}
function nomeCheio(e) {
  if (!e) return "";
  return [e.nome, e.bairro].filter(Boolean).join(" · ");
}
function itemLugar(icone, titulo, sub, onclick) {
  const b = document.createElement("button"); b.className = "item-lista"; b.onclick = onclick;
  b.innerHTML = `<i>${icone}</i><div><b></b><span></span></div><em>›</em>`;
  b.querySelector("b").textContent = titulo; b.querySelector("span").textContent = sub; return b;
}
function montarLugares() {
  const el = $("lugares"); el.textContent = "";
  const r = recentes()[0];
  if (r) { const rot = rotuloLugar(r); el.append(itemLugar("🕒", rot.titulo, rot.sub, () => escolherDestino(r))); }
  const casa = guardar.ler("casa");
  el.append(itemLugar("🏠", "Casa", casa ? textoEndereco(casa.nome, casa.numero, casa.complemento) : "Adicionar endereço de casa", () => casa ? escolherDestino(casa) : definirLugar("casa")));
  const trab = guardar.ler("trabalho");
  if (trab) el.append(itemLugar("💼", "Trabalho", textoEndereco(trab.nome, trab.numero, trab.complemento), () => escolherDestino(trab)));
  show("cardBoasVindas", historico.length === 0);
}
function montarServicos() {
  const tile = c => { const b = document.createElement("button"); b.className = "servico";
    b.innerHTML = `<span class="bolha">${c.icone}</span><span></span>`; b.lastChild.textContent = c.nome;
    b.onclick = () => { categoria = c; if ($("categoriaAtual")) $("categoriaAtual").textContent = c.nome; irAba("home"); abrirPlano(); }; return b; };
  $("servicos").textContent = ""; CATEGORIAS.slice(0, 5).forEach(c => $("servicos").append(tile(c)));
  $("gradeServicos").textContent = ""; CATEGORIAS.forEach(c => $("gradeServicos").append(tile(c)));
}
function definirLugar(tipo) {
  definindo = tipo;
  abrirPlano();
  $("destino").placeholder = "Digite o endereço de " + (tipo === "casa" ? "casa" : "trabalho");
  $("destino").focus();
  atualizarBotaoPlano();
}
let definindo = null;
function usarLugar(tipo) { const l = guardar.ler(tipo); if (l) escolherDestino(l); else definirLugar(tipo); }
function maisTarde() { toast("Agendamento chega em breve! Por enquanto, as entregas são para agora."); }

// ---------- Planejar ----------
let origemGps = false;
function aplicarGpsNoPlano() {
  const campo = $("origem");
  const tela = $("telaPlano");
  if (!campo || !tela || tela.classList.contains("hidden")) return;
  const ocupado = campo.dataset.gps !== "1" && !!origem && !origemGps;
  if (ocupado) return;
  if (!aqui || !dentroPelotas(aqui.lat, aqui.lng)) return;
  if (!aqui.nome) {
    campo.value = "Buscando localização…";
    campo.dataset.gps = "1";
    campo.dataset.escolhido = "";
    atualizarLimpar();
    return;
  }
  origem = { nome: aqui.nome, lat: aqui.lat, lng: aqui.lng, numero: "S/N", complemento: "", tipo: "poi" };
  origemGps = true;
  campo.value = textoCampo(aqui.nome, "");
  campo.dataset.escolhido = "1";
  campo.dataset.gps = "1";
  atualizarLimpar();
  if (!$("destino").value && (document.activeElement === campo || document.activeElement === document.body)) $("destino").focus();
}
function abrirPlano() {
  telaSobre("telaPlano", true);
  if (!definindo) show("blocoSalvar", false);
  if (origem && $("origem").dataset.gps !== "1") {
    $("origem").value = textoCampo(origem.nome, origem.numero);
    $("origem").dataset.escolhido = "1";
  } else aplicarGpsNoPlano();
  if (destino && destino.nome) {
    $("destino").value = textoCampo(destino.nome, destino.numero);
    $("destino").dataset.escolhido = "1";
  }
  atualizarBotaoPlano();
  atualizarLimpar();
  clearTimeout(focoPlano);
  focoPlano = setTimeout(() => {
    const ativo = document.activeElement;
    if (ativo && ativo.closest && ativo.closest("#telaPlano") && ativo.matches("input, textarea")) return;
    ($("origem").value ? $("destino") : $("origem")).focus();
  }, 50);
}
let focoPlano = null;
function fecharPlano() {
  alojarNumeros(false);
  show("blocoSalvar", false);
  telaSobre("telaPlano", false);
  definindo = null;
  $("destino").placeholder = "Para onde?";
  atualizarBotaoPlano();
}
function escolherDestino(e) { definirLado("destino", e); }
function sufixo(lado) { return lado === "origem" ? "Origem" : "Destino"; }
function rotuloLugar(e) {
  const partes = String(e.nome || "").split(" · ");
  const extra = [e.numero === "S/N" ? "S/N" : e.numero ? "nº " + e.numero : "", e.complemento].filter(Boolean).join(" · ");
  return { titulo: partes[0] || e.nome, sub: [partes[1], extra].filter(Boolean).join(" · ") || "Pelotas" };
}
function ligarSn(lado) {
  const s = sufixo(lado), sn = $("sn" + s), num = $("num" + s);
  sn.onchange = () => { num.disabled = sn.checked; if (sn.checked) num.value = ""; };
}
function preencherDetalhe(lado, obj) {
  const s = sufixo(lado);
  show("det" + s, true);
  const sn = obj.numero === "S/N";
  $("sn" + s).checked = sn;
  $("num" + s).disabled = sn;
  $("num" + s).value = sn ? "" : (obj.numero || "");
  $("comp" + s).value = obj.complemento || "";
}
function limparDetalhe(lado) {
  const s = sufixo(lado);
  show("det" + s, false);
  $("sn" + s).checked = false;
  $("num" + s).disabled = false;
  $("num" + s).value = "";
  $("comp" + s).value = "";
  if (lado === "origem") origem = null; else destino = null;
}
function limparCampo(lado) {
  const campo = $(lado);
  campo.value = "";
  campo.dataset.escolhido = "";
  campo.dataset.gps = "";
  if (lado === "origem") origemGps = false;
  limparDetalhe(lado);
  const lista = $("sug" + sufixo(lado));
  if (lista) lista.innerHTML = "";
  atualizarLimpar();
  if (campo._ejaRecentes) campo._ejaRecentes();
  campo.focus();
}
function atualizarLimpar() {
  show("limparOrigem", !!$("origem").value);
  show("limparDestino", !!$("destino").value);
  if ($("limparPino") && $("buscaPino")) show("limparPino", !!$("buscaPino").value);
}
function numeroDoTexto(e) {
  return { numero: e.numero || "S/N", complemento: e.complemento || "" };
}
function definirLado(lado, e) {
  const extra = numeroDoTexto(e);
  const obj = {
    nome: e.nome, lat: e.lat, lng: e.lng, numero: extra.numero, complemento: extra.complemento,
    bairro: e.bairro || "", cidade: e.cidade || "", uf: e.uf || "", cep: e.cep || "", tipo: e.tipo || ""
  };
  if (lado === "origem") origem = obj; else destino = obj;
  const campo = $(lado);
  if (campo) {
    campo.value = textoCampo(e.nome, extra.numero);
    campo.dataset.escolhido = "1";
    campo.dataset.gps = "";
    if (lado === "origem") origemGps = false;
  }
  lembrarRecente(obj);
  atualizarLimpar();
  if (lado === "destino" && !origem && !definindo) {
    if ($("telaPlano").classList.contains("hidden")) abrirPlano();
    if (!origem) { toast("Agora escolha o endereço de retirada."); $("origem").focus(); return; }
  }
  if (definindo) {
    show("blocoSalvar", true);
    preencherDetalhe(lado, obj);
    if ($("btnContinuar")) show("btnContinuar", true);
    return;
  }
  if (origem && destino && origem.lat != null && destino.lat != null && origem.numero && destino.numero) abrirConfirmar();
}
function limparDetalheVisual(lado) {
  const s = sufixo(lado);
  show("det" + s, false);
  $("sn" + s).checked = false;
  $("num" + s).disabled = false;
  $("num" + s).value = "";
  $("comp" + s).value = "";
}
function trocarPontos() {
  const o = origem, d = destino;
  const vo = $("origem").value, vd = $("destino").value;
  const eo = $("origem").dataset.escolhido, ed = $("destino").dataset.escolhido;
  origem = d; destino = o;
  $("origem").value = vd; $("destino").value = vo;
  $("origem").dataset.escolhido = ed || "";
  $("destino").dataset.escolhido = eo || "";
  if (origem && origem.numero) preencherDetalhe("origem", origem); else limparDetalheVisual("origem");
  if (destino && destino.numero) preencherDetalhe("destino", destino); else limparDetalheVisual("destino");
  atualizarLimpar();
}
function alojarNumeros(noMapa) {
  const o = $("detOrigem"), d = $("detDestino");
  if (!o || !d) return;
  if (noMapa && $("numsMapa")) {
    $("numsMapa").append(o, d);
    if (origem) preencherDetalhe("origem", origem); else show("detOrigem", false);
    if (destino) preencherDetalhe("destino", destino); else show("detDestino", false);
  } else {
    const guarda = $("blocoSalvar");
    if (guarda) guarda.insertBefore(d, guarda.firstChild);
    if (guarda) guarda.insertBefore(o, guarda.firstChild);
    if (!definindo) { show("detOrigem", false); show("detDestino", false); show("blocoSalvar", false); }
  }
}
function lerDetalhe(lado) {
  const s = sufixo(lado);
  const painel = $("det" + s);
  if (painel && painel.classList.contains("hidden")) {
    const obj = lado === "origem" ? origem : destino;
    if (!obj) return { ok: false, erro: "Escolha o endereço." };
    return validarDetalhe(obj.numero === "S/N" ? "" : (obj.numero || ""), obj.numero === "S/N", obj.complemento);
  }
  return validarDetalhe($("num" + s).value, $("sn" + s).checked, $("comp" + s).value);
}
function atualizarBotaoPlano() {
  const b = $("btnContinuar");
  if (b) b.textContent = definindo ? "Salvar este endereço" : "Continuar";
}
function continuarPlano() {
  if (definindo) {
    if (!destino || $("destino").dataset.escolhido !== "1") { toast("Escolha o endereço na lista ou no mapa."); return; }
    const b = lerDetalhe("destino");
    if (!b.ok) { toast(b.erro); $("numDestino").focus(); return; }
    guardar.gravar(definindo, { nome: destino.nome, lat: destino.lat, lng: destino.lng, numero: b.numero, complemento: b.complemento });
    toast((definindo === "casa" ? "Casa" : "Trabalho") + " salvo!");
    definindo = null; destino = null; $("destino").value = ""; limparDetalhe("destino");
    fecharPlano(); montarLugares();
    const casaSalva = guardar.ler("casa"), trabSalvo = guardar.ler("trabalho");
    if ($("contaCasa")) $("contaCasa").textContent = casaSalva ? textoEndereco(casaSalva.nome, casaSalva.numero, casaSalva.complemento) : "Adicionar";
    if ($("contaTrabalho")) $("contaTrabalho").textContent = trabSalvo ? textoEndereco(trabSalvo.nome, trabSalvo.numero, trabSalvo.complemento) : "Adicionar";
    return;
  }
  if (!origem || $("origem").dataset.escolhido !== "1") { toast("Escolha o endereço de retirada na lista."); $("origem").focus(); return; }
  if (!destino || $("destino").dataset.escolhido !== "1") { toast("Escolha o endereço de entrega na lista."); $("destino").focus(); return; }
  const a = lerDetalhe("origem"), b = lerDetalhe("destino");
  if (!a.ok) { toast("Retirada: " + a.erro); $("numOrigem").focus(); return; }
  if (!b.ok) { toast("Entrega: " + b.erro); $("numDestino").focus(); return; }
  origem.numero = a.numero; origem.complemento = a.complemento;
  destino.numero = b.numero; destino.complemento = b.complemento;
  abrirConfirmar();
}

// ---------- Escolher no mapa (pino arrastável) ----------
let pinoLado = "destino", pinoTextoFixo = "", pinoAtual = null, pinoBuscaLigada = false;
let pinoAlvo = null, cameraPropria = 0, pinoNomeando = false, pinoSeq = 0, nomearTimer = null;
function marcarNoMapa(lado, texto) { abrirPinoMapa(lado, texto); }
function paddingPino() {
  const el = mapaPino.getContainer();
  const H = el.clientHeight || window.innerHeight || 700;
  const W = el.clientWidth || window.innerWidth || 360;
  const folha = $("folhaPino");
  const fh = folha ? (parseFloat(folha.style.height) || folha.getBoundingClientRect().height || H * 0.42) : H * 0.42;
  const top = 84;
  let bottom = Math.max(0, fh);
  if (top + bottom > H - 96) bottom = Math.max(0, H - 96 - top);
  return { top, bottom, left: Math.min(24, W * 0.06), right: Math.min(24, W * 0.06) };
}
function posicionarPinoVisual() {
  const pin = document.querySelector("#telaPino .pino-central");
  if (!pin || !mapaPino) return { x: 0, y: 0 };
  const el = mapaPino.getContainer();
  const H = el.clientHeight || window.innerHeight || 700;
  const W = el.clientWidth || window.innerWidth || 360;
  const pad = paddingPino();
  const y = (pad.top + H - pad.bottom) / 2;
  const x = (pad.left + W - pad.right) / 2;
  pin.style.top = y + "px";
  pin.style.left = x + "px";
  return { x, y };
}
function pontoDoPino() {
  if (!mapaPino) return { lat: PELOTAS[0], lng: PELOTAS[1] };
  const pt = posicionarPinoVisual();
  return mapaPino.containerPointToLatLng([pt.x, pt.y]);
}
function centralizarPino(ll, zoom, duracao) {
  if (!mapaPino || !ll) return;
  pinoAlvo = { lat: +ll.lat, lng: +ll.lng };
  posicionarPinoVisual();
  cameraPropria++;
  mapaPino.setView([pinoAlvo.lat, pinoAlvo.lng], zoom == null ? mapaPino.getZoom() : zoom, {
    padding: paddingPino(), duration: duracao || 0, bearing: 0, pitch: 0
  });
  setTimeout(() => { cameraPropria = Math.max(0, cameraPropria - 1); }, (duracao || 0) + 80);
}
function atualizarBotaoPino() {
  const btn = $("btnPino");
  const fora = pinoAtual && pinoAtual.fora;
  if (btn) btn.disabled = !!(pinoNomeando || !pinoAtual || !pinoAtual.nome || fora);
  show("pinoFora", !!fora);
}
function agendarNomear() {
  clearTimeout(nomearTimer);
  pinoNomeando = true;
  atualizarBotaoPino();
  $("pinoNome").textContent = "Buscando endereço…";
  nomearTimer = setTimeout(nomearPino, 350);
}
function abrirPinoMapa(lado, texto) {
  pinoLado = lado === "origem" ? "origem" : "destino";
  pinoTextoFixo = texto || "";
  telaSobre("telaPino", true);
  if (!mapaPino) {
    mapaPino = criarMapa("mapaPino", { rotacao: false, limiteCidade: true, zoom: 16 });
    mapaPino.on("moveend", () => {
      if ($("telaPino").classList.contains("hidden")) return;
      const novo = pontoDoPino();
      const mesmo = pinoAlvo && Math.abs(novo.lat - pinoAlvo.lat) < 0.00004 && Math.abs(novo.lng - pinoAlvo.lng) < 0.00004;
      if (cameraPropria > 0 || mesmo) {
        if (mesmo) pinoAlvo = { lat: novo.lat, lng: novo.lng };
        return;
      }
      pinoTextoFixo = "";
      pinoAlvo = novo;
      agendarNomear();
    });
  }
  if (!pinoBuscaLigada) {
    pinoBuscaLigada = true;
    autocompletar($("buscaPino"), $("sugPino"), e => {
      pinoTextoFixo = "";
      pinoAtual = { lat: e.lat, lng: e.lng, nome: e.nome, numero: e.numero || "", complemento: e.complemento || "", bairro: e.bairro || "", fora: false };
      $("pinoNome").textContent = e.titulo || e.nome;
      $("buscaPino").value = e.titulo || e.nome;
      atualizarLimpar();
      pinoNomeando = false;
      clearTimeout(nomearTimer);
      centralizarPino(e, 17, 0);
      atualizarBotaoPino();
    }, t => {
      pinoTextoFixo = t;
      $("buscaPino").value = t;
      atualizarLimpar();
      agendarNomear();
    }, { bias: () => pinoAlvo && dentroPelotas(pinoAlvo.lat, pinoAlvo.lng) ? [pinoAlvo.lat, pinoAlvo.lng] : biasBusca() });
    $("buscaPino").addEventListener("input", atualizarLimpar);
    $("buscaPino").addEventListener("focus", limitarSugestaoPino);
    if (!$("sugPino")._ejaObs) {
      $("sugPino")._ejaObs = new MutationObserver(() => { if (document.activeElement === $("buscaPino")) limitarSugestaoPino(); });
      $("sugPino")._ejaObs.observe($("sugPino"), { childList: true });
    }
    $("limparPino").onclick = () => { $("buscaPino").value = ""; $("sugPino").innerHTML = ""; pinoTextoFixo = ""; atualizarLimpar(); };
  }
  $("buscaPino").value = pinoTextoFixo;
  atualizarLimpar();
  const titulo = $("folhaPino").querySelector("h2");
  if (titulo) titulo.textContent = pinoLado === "origem" ? "Marque a retirada" : "Marque o destino";
  const c = (pinoLado === "origem" ? origem : destino) || aqui;
  const ll = c && c.lat != null ? { lat: c.lat, lng: c.lng } : { lat: PELOTAS[0], lng: PELOTAS[1] };
  if (c && c.nome && !texto) {
    pinoAtual = { lat: ll.lat, lng: ll.lng, nome: c.nome, numero: c.numero || "S/N", complemento: c.complemento || "", bairro: c.bairro || "" };
    $("pinoNome").textContent = c.nome;
    pinoNomeando = false;
  } else if (texto) {
    pinoAtual = { lat: ll.lat, lng: ll.lng, nome: texto };
    $("pinoNome").textContent = texto;
    pinoNomeando = false;
  } else pinoAtual = null;
  atualizarBotaoPino();
  setTimeout(() => {
    ajustarMapa(mapaPino);
    folhaIr($("folhaPino"), 1);
    pintarPontoAzul(mapaPino, "pino");
    centralizarPino(ll, 17, 0);
    if (!pinoAtual || !pinoAtual.nome) agendarNomear();
  }, 80);
}
async function nomearPino() {
  if (!mapaPino || $("telaPino").classList.contains("hidden")) return;
  const c = pontoDoPino();
  pinoAlvo = { lat: c.lat, lng: c.lng };
  const seq = ++pinoSeq;
  if (!dentroPelotas(c.lat, c.lng)) {
    pinoNomeando = false;
    pinoAtual = { lat: c.lat, lng: c.lng, nome: null, fora: true };
    $("pinoNome").textContent = "Fora de Pelotas";
    atualizarBotaoPino();
    return;
  }
  if (pinoTextoFixo) {
    pinoNomeando = false;
    pinoAtual = { lat: c.lat, lng: c.lng, nome: pinoTextoFixo, fora: false };
    $("pinoNome").textContent = pinoTextoFixo;
    atualizarBotaoPino();
    return;
  }
  pinoNomeando = true;
  atualizarBotaoPino();
  $("pinoNome").textContent = "Buscando endereço…";
  const n = await nomeDoPonto(c.lat, c.lng, { timeout: 4000 });
  if (seq !== pinoSeq) return;
  const agora = pontoDoPino();
  if (Math.abs(agora.lat - c.lat) > 0.00015 || Math.abs(agora.lng - c.lng) > 0.00015) return;
  pinoNomeando = false;
  pinoAtual = { lat: c.lat, lng: c.lng, nome: n || "Ponto no mapa", fora: false };
  $("pinoNome").textContent = pinoAtual.nome;
  atualizarBotaoPino();
}
function fecharPino() { clearTimeout(nomearTimer); telaSobre("telaPino", false); }
function confirmarPino() {
  if (pinoNomeando || !pinoAtual || !pinoAtual.nome) return;
  if (pinoAtual.fora || !dentroPelotas(pinoAtual.lat, pinoAtual.lng)) return toast("Por enquanto atendemos só Pelotas.");
  const ponto = {
    nome: pinoAtual.nome, lat: pinoAtual.lat, lng: pinoAtual.lng,
    numero: pinoAtual.numero || "S/N", complemento: pinoAtual.complemento || "", bairro: pinoAtual.bairro || "", tipo: "poi"
  };
  const lado = pinoLado;
  pinoTextoFixo = "";
  fecharPino();
  if (lado === "origem") definirLado("origem", ponto);
  else escolherDestino(ponto);
}

// Enquadra pontos na faixa do mapa que fica acima da folha. O padding de baixo
// nunca passa de metade da tela: uma folha alta empurrava o ponto A para fora.
function alturaFolha(sel) {
  const f = sel ? document.querySelector(sel) : null;
  if (!f) return Math.round((window.innerHeight || 700) * 0.34);
  return parseFloat(f.style.height) || f.getBoundingClientRect().height || Math.round((window.innerHeight || 700) * 0.34);
}
function enquadrar(m, pts, folhaSel, duracao) {
  enquadrarMapa(m, pts, alturaFolha(folhaSel), duracao);
}
const pontosAzuis = {};
function pintarPontoAzul(mapa, chave) {
  if (!mapa || !aqui || !dentroPelotas(aqui.lat, aqui.lng)) return;
  if (pontosAzuis[chave]) pontosAzuis[chave].remove();
  pontosAzuis[chave] = colocarMarcador(mapa, aqui.lat, aqui.lng, htmlPontoUsuario());
}
function pintarPontosAzuis() {
  if (mapaPino && !$("telaPino").classList.contains("hidden")) pintarPontoAzul(mapaPino, "pino");
  if (mapa && !$("telaConfirmar").classList.contains("hidden")) pintarPontoAzul(mapa, "confirmar");
  if (mapaPed && !$("pedido").classList.contains("hidden")) pintarPontoAzul(mapaPed, "pedido");
}
function irParaMim(qual) {
  if (!aqui || aqui.lat == null) { atualizarLocal(true); return; }
  if (!dentroPelotas(aqui.lat, aqui.lng)) { toast("Você está fora de Pelotas."); return; }
  if (qual === "pino" && mapaPino) {
    pinoTextoFixo = "";
    pinoNomeando = false;
    clearTimeout(nomearTimer);
    pinoAtual = { lat: aqui.lat, lng: aqui.lng, nome: aqui.nome || "Minha localização", numero: "S/N", fora: false };
    $("pinoNome").textContent = pinoAtual.nome;
    atualizarBotaoPino();
    centralizarPino(aqui, 17, 350);
    return;
  }
  const m = qual === "pedido" ? mapaPed : mapa;
  if (!m) return;
  if (qual === "pedido") { seguirPedido = false; $("pedido").classList.add("mapa-livre"); }
  else $("telaConfirmar").classList.add("mapa-livre");
  if (m.easePara) m.easePara({ lat: aqui.lat, lng: aqui.lng, zoom: 16, bearing: 0, pitch: 0, duration: 450 });
  else m.setView([aqui.lat, aqui.lng], 16, { bearing: 0, pitch: 0 });
}
let etaMin = null;
function desenharConfirmacao() {
  if (!mapa || !origem || !destino) return;
  camadas.forEach(c => c.remove());
  camadas = [
    colocarMarcador(mapa, origem.lat, origem.lng, htmlRetirada(nomeCheio(origem), etaMin)),
    colocarMarcador(mapa, destino.lat, destino.lng, htmlEntrega(nomeCheio(destino)))
  ];
  pintarPontoAzul(mapa, "confirmar");
  const reta = [[origem.lat, origem.lng], [destino.lat, destino.lng]];
  const pts = rota && rota.linha && rota.linha.length > 1 ? rota.linha : reta;
  if (rota && rota.linha && rota.linha.length > 1) camadas.push(colocarLinha(mapa, rota.linha, ROTA));
  else camadas.push(colocarLinha(mapa, reta, { color: "#111111", weight: 4, opacity: 0.85, tracejada: true }));
  enquadrar(mapa, pts, "#deliveryForm");
}
function nortear(m) {
  if (!m || !m.getCenter || !m.setView) return;
  const c = m.getCenter();
  m.setView([c.lat, c.lng], m.getZoom(), { bearing: 0, pitch: 0, duration: 0 });
}
function verRotaConfirmada() {
  $("telaConfirmar").classList.remove("mapa-livre");
  nortear(mapa);
  desenharConfirmacao();
}

// ---------- Confirmar com preço ----------
async function abrirConfirmar() {
  telaSobre("telaConfirmar", true);
  $("resOrigem").textContent = textoEndereco(nomeCheio(origem), origem.numero, origem.complemento);
  $("resDestino").textContent = textoEndereco(nomeCheio(destino), destino.numero, destino.complemento);
  $("tagCategoria").textContent = categoria.nome;
  $("tipo").innerHTML = ""; categoria.itens.filter(i => !/NÃO/.test(i)).forEach(i => $("tipo").add(new Option(i, categoria.nome + ": " + i)));
  alojarNumeros(true);
  if (!mapa) {
    mapa = criarMapa("mapa", { rotacao: false, limiteCidade: true });
    mapa.on("dragstart", () => { $("telaConfirmar").classList.add("mapa-livre"); });
  }
  folhaIr($("deliveryForm"), 1);
  await new Promise(r => setTimeout(r, 80));
  etaMin = null;
  desenharConfirmacao();
  $("valor").textContent = "—"; $("km").textContent = "Calculando rota…";
  rota = await calcularRota(origem, destino);
  if (rota && rota.segundos) etaMin = Math.max(1, Math.round(rota.segundos / 60));
  desenharConfirmacao();
  const { data, error } = await db.rpc("cotar_preco", params());
  if (error) { $("km").textContent = erroMsg(error); return; }
  $("valor").textContent = money(data[0].preco);
  const km = Number(data[0].distancia_km).toLocaleString("pt-BR");
  const pelaRua = data[0].fonte === "rota" && rota;
  $("km").textContent = km + " km" + (pelaRua ? " pela rua" : " · distância estimada") + (etaMin ? " · ~" + etaMin + " min" : "");
  desenharConfirmacao();
}
function voltarDoConfirmar() { alojarNumeros(false); telaSobre("telaConfirmar", false); abrirPlano(); }
function params() {
  return { p_ret_lat: origem.lat, p_ret_lng: origem.lng, p_ent_lat: destino.lat, p_ent_lng: destino.lng, p_rota_km: rota ? Number(rota.km.toFixed(2)) : null };
}

["numOrigem", "numDestino", "compOrigem", "compDestino"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("keydown", ev => { if (ev.key === "Enter") ev.preventDefault(); });
});
function rumoEntre(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
$("deliveryForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const a = lerDetalhe("origem"), b = lerDetalhe("destino");
  if (!a.ok) { toast("Retirada: " + a.erro); $("numOrigem").focus(); return; }
  if (!b.ok) { toast("Entrega: " + b.erro); $("numDestino").focus(); return; }
  origem.numero = a.numero; origem.complemento = a.complemento;
  destino.numero = b.numero; destino.complemento = b.complemento;
  const botao = $("btnConfirmar"); botao.disabled = true;
  try {
    const { data, error } = await db.rpc("criar_pedido", {
      p_retirada: nomeCheio(origem).trim(), p_entrega: nomeCheio(destino).trim(), p_item: $("tipo").value.slice(0, 60),
      p_ret_numero: origem.numero, p_ret_complemento: origem.complemento, p_ent_numero: destino.numero, p_ent_complemento: destino.complemento,
      ...params() });
    if (error) throw error;
    const p = data[0];
    telaSobre("telaConfirmar", false); telaSobre("telaPlano", false);
    mostrarPedido({ id: p.pedido_id, retirada: nomeCheio(origem).trim(), entrega: nomeCheio(destino).trim(), item: $("tipo").value, preco: p.valor,
      status: "procurando", codigo: p.cod, ret_lat: origem.lat, ret_lng: origem.lng, ent_lat: destino.lat, ent_lng: destino.lng,
      ret_numero: origem.numero, ret_complemento: origem.complemento, ent_numero: destino.numero, ent_complemento: destino.complemento });
  } catch (e) { toast("Não foi possível pedir: " + erroMsg(e), 4000); }
  finally { botao.disabled = false; }
});

// ---------- Pedido em andamento ----------
let seguirPedido = true;
function pontosDoPedido() {
  const pts = [];
  if (!pedido) return pts;
  if (pedido.ret_lat != null && pedido.ret_lng != null) pts.push([+pedido.ret_lat, +pedido.ret_lng]);
  if (pedido.ent_lat != null && pedido.ent_lng != null) pts.push([+pedido.ent_lat, +pedido.ent_lng]);
  if (pedido.motoPos) pts.push(pedido.motoPos);
  return pts;
}
function enquadrarPedido() {
  const pts = pontosDoPedido();
  if (mapaPed && pts.length) enquadrar(mapaPed, pts, "#folhaPedido");
}
function verRotaPedido() { seguirPedido = true; $("pedido").classList.remove("mapa-livre"); nortear(mapaPed); enquadrarPedido(); }

async function mostrarPedido(p) {
  pedido = p; ultimoS = null; seguirPedido = true;
  telaSobre("pedido", true); show("btnCancelar", true); show("btnNovo", false); show("avaliar", false); show("btnWhats", true);
  $("resumo").textContent = textoEndereco(p.retirada, p.ret_numero, p.ret_complemento) + " → " +
    textoEndereco(p.entrega, p.ent_numero, p.ent_complemento) + " · " + p.item + " · " + money(p.preco);
  if (!mapaPed) {
    mapaPed = criarMapa("mapaPedido", { rotacao: false, limiteCidade: true });
    mapaPed.on("dragstart", () => { seguirPedido = false; $("pedido").classList.add("mapa-livre"); });
  } else setTimeout(() => ajustarMapa(mapaPed), 60);
  if (p.ret_lat == null) {
    const { data } = await db.from("pedidos").select("ret_lat,ret_lng,ent_lat,ent_lng,ret_numero,ret_complemento,ent_numero,ent_complemento").eq("id", p.id).single();
    Object.assign(p, data || {});
    $("resumo").textContent = textoEndereco(p.retirada, p.ret_numero, p.ret_complemento) + " → " +
      textoEndereco(p.entrega, p.ent_numero, p.ent_complemento) + " · " + p.item + " · " + money(p.preco);
  }
  camadasPed.forEach(c => c.remove());
  camadasPed = [];
  if (p.ret_lat != null && p.ent_lat != null) {
    camadasPed.push(colocarMarcador(mapaPed, p.ret_lat, p.ret_lng, htmlRetirada(p.retirada)));
    camadasPed.push(colocarMarcador(mapaPed, p.ent_lat, p.ent_lng, htmlEntrega(p.entrega)));
    pintarPontoAzul(mapaPed, "pedido");
    calcularRota({ lat: p.ret_lat, lng: p.ret_lng }, { lat: p.ent_lat, lng: p.ent_lng }).then(r => {
      if (!mapaPed || pedido !== p) return;
      const reta = [[+p.ret_lat, +p.ret_lng], [+p.ent_lat, +p.ent_lng]];
      camadasPed.push(colocarLinha(mapaPed, r && r.linha ? r.linha : reta, r && r.linha ? ROTA : { color: "#111111", weight: 4, opacity: 0.85, tracejada: true }));
      if (seguirPedido) enquadrarPedido();
    });
  }
  folhaIr($("folhaPedido"), 0);
  setTimeout(enquadrarPedido, 160);
  atualizarStatus();
  if (canal) db.removeChannel(canal);
  canal = db.channel("pedido-" + p.id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: "id=eq." + p.id }, atualizarStatus)
    .on("postgres_changes", { event: "*", schema: "public", table: "posicoes", filter: "pedido_id=eq." + p.id }, m => m.new && m.new.lat && moverMoto(m.new.lat, m.new.lng, m.new.heading || m.new.bearing || m.new.rumo))
    .subscribe();
  sincronizarChatCliente();
}
function moverMoto(lat, lng, heading) {
  if (!mapaPed || lat == null || lng == null) return;
  const primeiro = !pedido.motoPos;
  const anterior = pedido.motoPos;
  pedido.motoPos = [+lat, +lng];
  if (!motoMarker) motoMarker = colocarMarcador(mapaPed, pedido.motoPos[0], pedido.motoPos[1], htmlMoto());
  else motoMarker.setLatLng(pedido.motoPos);
  let rumo = heading == null || heading !== heading ? null : Number(heading);
  if (rumo == null && anterior) rumo = rumoEntre({ lat: anterior[0], lng: anterior[1] }, { lat: +lat, lng: +lng });
  if (rumo != null) orientarMarcador(motoMarker, rumo, mapaPed.getBearing ? mapaPed.getBearing() : 0);
  let fora = false;
  try { fora = !mapaPed.getBounds().pad(-0.05).contains(pedido.motoPos); } catch (e) { fora = true; }
  if (seguirPedido && (primeiro || fora)) enquadrarPedido();
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
  if ($("folhaPedido") && $("folhaPedido").dataset.snap === "colapsada") folhaIr($("folhaPedido"), 0);
  if (s.status === "aceito" && ultimoS && ultimoS !== "aceito") Alerta.tocarAceito();
  ultimoS = s.status;
  if (s.status === "aceito" || s.status === "coletado") {
    const { data: pos } = await db.from("posicoes").select("lat,lng").eq("pedido_id", pedido.id).maybeSingle();
    if (pos) moverMoto(pos.lat, pos.lng, pos.heading || pos.bearing || pos.rumo);
  } else if (motoMarker) { motoMarker.remove(); motoMarker = null; }
  if (s.status === "entregue" || s.status === "cancelado") {
    show("btnCancelar", false); show("btnNovo", true); show("btnWhats", false);
    if (s.status === "entregue") montarAvaliacao();
  }
  sincronizarChatCliente();
}
function sincronizarChatCliente() {
  if (!pedido || !usuario) { Chat.parar(); return; }
  Chat.ligar({ pedidoId: pedido.id, meuId: usuario.id, status: pedido.status, outro: "Motoboy" });
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
  Chat.parar();
  if (motoMarker) { motoMarker.remove(); motoMarker = null; }
  $("origem").value = ""; $("destino").value = ""; $("origem").dataset.escolhido = ""; $("destino").dataset.escolhido = "";
  limparDetalhe("origem"); limparDetalhe("destino");
  telaSobre("pedido", false); irAba("home"); carregarHistorico();
}

// Compartilhar rastreio (WhatsApp): status, motoboy, código e link do mapa com a posição atual.
function compartilharWhats() {
  if (!pedido) return;
  let t = `🛵 *É-Já* — entrega a caminho!\nDe: ${textoEndereco(pedido.retirada, pedido.ret_numero, pedido.ret_complemento)}\nPara: ${textoEndereco(pedido.entrega, pedido.ent_numero, pedido.ent_complemento)}`;
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
        else toast(textoEndereco(p.retirada, p.ret_numero, p.ret_complemento) + " → " + textoEndereco(p.entrega, p.ent_numero, p.ent_complemento) + " · " + money(p.preco), 4000);
      });
    b.querySelector("em").textContent = money(p.preco);
    el.append(b);
  });
}

setInterval(atualizarStatus, 10000);

ligarFolha($("folhaPino"), { inicial: 1 });
ligarFolha($("deliveryForm"), { inicial: 1 });
ligarFolha($("folhaPedido"), { inicial: 0 });
window.addEventListener("eja-folha", ev => {
  const f = ev.detail && ev.detail.folha;
  if (!f) return;
  const duracao = ev.detail.arrastando ? 0 : undefined;
  if (f.id === "folhaPedido" && pedido && mapaPed && seguirPedido) enquadrar(mapaPed, pontosDoPedido(), "#folhaPedido", duracao);
  if (f.id === "folhaPino" && mapaPino && !$("telaPino").classList.contains("hidden")) {
    posicionarPinoVisual();
    if (pinoAlvo) centralizarPino(pinoAlvo, mapaPino.getZoom(), 0);
  }
  if (f.id === "deliveryForm" && mapa && origem && destino) {
    const pts = rota && rota.linha ? rota.linha : [[origem.lat, origem.lng], [destino.lat, destino.lng]];
    enquadrar(mapa, pts, "#deliveryForm", duracao);
  }
});
