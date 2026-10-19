// Confere no Chrome a tela de número (cliente) e a navegação/chat (motoboy).
// Os apps precisam estar servidos (8081 cliente, 8082 motoboy) e o shared já copiado.
// Não cria pedido nem grava no Supabase: as chamadas de rede do app são trocadas por um banco falso.
import { createRequire } from "node:module";
const require = createRequire("/tmp/pglite-harness/package.json");
const puppeteer = require("puppeteer-core");

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=800,1280"]
});
const falhas = [];
function ok(cond, msg) {
  if (!cond) falhas.push(msg);
  console.log((cond ? "ok  " : "FALHA ") + msg);
}

try {
  const cliente = await browser.newPage();
  await cliente.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await cliente.evaluateOnNewDocument(() => localStorage.setItem("eja_onboarding_ok", "true"));
  await cliente.goto("http://127.0.0.1:8081/", { waitUntil: "networkidle2", timeout: 30000 });
  await cliente.waitForFunction(() => typeof definirLado === "function" && typeof continuarPlano === "function");
  const numero = await cliente.evaluate(async () => {
    calcularRota = async () => null;
    db.rpc = async () => ({ data: null, error: { message: "sem sessão neste teste" } });
    show("telaOnboarding", false);
    show("telaAuth", false);
    show("telaApp", true);
    ligarSn("origem"); ligarSn("destino");
    definirLado("origem", { nome: "Rua General Osório · Centro", lat: -31.765, lng: -52.337 });
    definirLado("destino", { nome: "Avenida Bento Gonçalves · Areal", lat: -31.752, lng: -52.328 });
    continuarPlano();
    const toastSem = $("toast").textContent;
    $("numOrigem").value = "100";
    $("compOrigem").value = "em frente à praça";
    $("snDestino").checked = true;
    $("snDestino").dispatchEvent(new Event("change"));
    const destinoTravado = $("numDestino").disabled && $("numDestino").value === "";
    continuarPlano();
    await new Promise(r => setTimeout(r, 200));
    return {
      toastSem,
      destinoTravado,
      origem: $("resOrigem").textContent,
      destino: $("resDestino").textContent,
      confirmar: !$("telaConfirmar").classList.contains("hidden")
    };
  });
  ok(/número/.test(numero.toastSem), "sem número, o cliente vê o aviso: " + numero.toastSem);
  ok(numero.destinoTravado, "S/N desliga o campo de número");
  ok(numero.confirmar && /nº 100/.test(numero.origem) && /praça/.test(numero.origem), "confirmação mostra nº 100 e o complemento: " + numero.origem);
  ok(/S\/N/.test(numero.destino), "confirmação mostra S/N na entrega: " + numero.destino);
  await cliente.screenshot({ path: "/opt/cursor/artifacts/cliente-numero.png" });

  const confirmar = await cliente.evaluate(async () => {
    calcularRota = async () => ({ km: 2.4, segundos: 480, linha: [[-31.765, -52.337], [-31.76, -52.334], [-31.752, -52.328]] });
    db.rpc = async () => ({ data: [{ preco: 18.5, distancia_km: 2.4, fonte: "rota" }], error: null });
    await abrirConfirmar();
    let linha = false;
    for (let i = 0; i < 20 && !linha; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const layers = mapa.gl ? mapa.gl.getStyle().layers : [];
        linha = (layers || []).some(l => /^rota-/.test(l.id));
      } catch (e) {}
      if (mapa._eja === "leaflet") linha = !!document.querySelector("#mapa .leaflet-overlay-pane path, #mapa .leaflet-overlay-pane canvas");
    }
    const topo = document.elementFromPoint(180, 150);
    return {
      eta: (document.querySelector("#mapa .eta-badge") || {}).textContent || "",
      callouts: document.querySelectorAll("#mapa .uber-balao").length,
      halo: !!document.querySelector("#mapa .uber-halo"),
      quadrado: !!document.querySelector("#mapa .pin-b"),
      linha, tipo: mapa._eja,
      centro: mapa.getCenter(),
      noMapa: !!(topo && topo.closest && topo.closest(".maplibregl-map, .leaflet-container, .eja-marcador")),
      livre: $("telaConfirmar").classList.contains("mapa-livre")
    };
  });
  ok(confirmar.eta === "8 MIN" && confirmar.callouts >= 2 && confirmar.halo && confirmar.quadrado, "retirada com halo e 8 MIN, entrega com balão (" + confirmar.eta + ")");
  ok(confirmar.linha, "rota preta desenhada no mapa (" + confirmar.tipo + ")");
  ok(confirmar.noMapa && !confirmar.livre, "toque na área do mapa não cai na folha");
  const centroAntes = confirmar.centro;
  const caixaMapa = await cliente.$("#mapa").then(el => el.boundingBox());
  await cliente.mouse.move(caixaMapa.x + 180, caixaMapa.y + 150);
  await cliente.mouse.down();
  await cliente.mouse.move(caixaMapa.x + 40, caixaMapa.y + 280, { steps: 12 });
  await cliente.mouse.up();
  await cliente.waitForFunction(() => $("telaConfirmar").classList.contains("mapa-livre"), { timeout: 2000 }).catch(() => {});
  const depoisArraste = await cliente.evaluate(() => ({
    livre: $("telaConfirmar").classList.contains("mapa-livre"),
    fab: getComputedStyle(document.querySelector("#telaConfirmar .fab-mapa")).display,
    centro: mapa.getCenter()
  }));
  const mudou = Math.abs(depoisArraste.centro.lat - centroAntes.lat) > 0.0003 || Math.abs(depoisArraste.centro.lng - centroAntes.lng) > 0.0003;
  ok(mudou && depoisArraste.livre && depoisArraste.fab !== "none", "arrastar o mapa do cliente muda o centro e mostra recentralizar");
  await cliente.screenshot({ path: "/opt/cursor/artifacts/cliente-confirmar-360.png" });

  const pedidoMapa = async (largura, altura, arquivo) => {
    await cliente.setViewport({ width: largura, height: altura, isMobile: true, hasTouch: true });
    const info = await cliente.evaluate(async () => {
      db.rpc = async (fn) => {
        if (fn === "status_pedido") return { data: [{ status: "coletado", motoboy_nome: "Julio Motoboy", placa: "ABC1D23", modelo: "CG" }], error: null };
        return { data: null, error: null };
      };
      db.from = () => ({
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { lat: -31.74, lng: -52.338 }, error: null }),
        single: async () => ({ data: null, error: null })
      });
      db.channel = () => ({ on() { return this; }, subscribe() { return this; } });
      db.removeChannel = () => {};
      mostrarPedido({
        id: "p-mapa", retirada: "Rua Estevão Jorge dos Reis · Fragata", entrega: "Pelotas International Airport · Areal",
        item: "Entrega rápida: Outro item permitido", preco: 14.58, status: "coletado", codigo: "5706",
        ret_lat: -31.758, ret_lng: -52.351, ent_lat: -31.718, ent_lng: -52.327,
        ret_numero: "91", ent_numero: "13", ret_complemento: null, ent_complemento: null
      });
      await new Promise(r => setTimeout(r, 500));
      moverMoto(-31.74, -52.338);
      await new Promise(r => setTimeout(r, 400));
      const mapa = $("mapaPedido").getBoundingClientRect();
      const folha = $("folhaPedido").getBoundingClientRect();
      const marcas = [...document.querySelectorAll("#mapaPedido .pin-a, #mapaPedido .pin-b, #mapaPedido .pin-moto")].map(el => {
        const b = el.getBoundingClientRect();
        const cy = b.top + b.height / 2, cx = b.left + b.width / 2;
        return { cls: el.className, visivel: cy > mapa.top + 8 && cy < folha.top - 4 && cx > mapa.left && cx < mapa.right };
      });
      return {
        mapH: Math.round(mapa.height), vh: window.innerHeight,
        snap: $("folhaPedido").dataset.snap,
        marcas,
        folhaCobre: folha.height / window.innerHeight
      };
    });
    await cliente.screenshot({ path: arquivo });
    return info;
  };
  const pedidoPequeno = await pedidoMapa(360, 740, "/opt/cursor/artifacts/cliente-pedido-360.png");
  ok(pedidoPequeno.mapH >= pedidoPequeno.vh - 8, "mapa do cliente ocupa a tela (" + pedidoPequeno.mapH + "/" + pedidoPequeno.vh + ")");
  ok(pedidoPequeno.snap === "colapsada" && pedidoPequeno.folhaCobre < 0.55, "folha do pedido começa colapsada (" + pedidoPequeno.snap + ")");
  ok(pedidoPequeno.marcas.filter(m => /pin-a/.test(m.cls) && m.visivel).length === 1, "ponto A visível acima da folha");
  ok(pedidoPequeno.marcas.filter(m => /pin-b/.test(m.cls) && m.visivel).length === 1, "ponto B visível acima da folha");
  ok(pedidoPequeno.marcas.filter(m => /pin-moto/.test(m.cls) && m.visivel).length === 1, "moto ao vivo visível acima da folha");
  const pedidoGrande = await pedidoMapa(800, 1280, "/opt/cursor/artifacts/cliente-pedido-grande.png");
  ok(pedidoGrande.marcas.every(m => m.visivel), "tela grande mostra A, B e a moto");

  const arrasteCliente = await cliente.evaluate(() => {
    const folha = $("folhaPedido");
    const antes = folha.getBoundingClientRect().height;
    const alca = folha.querySelector(".alca");
    const r = alca.getBoundingClientRect();
    const ev = (tipo, y) => alca.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", button: 0, clientX: r.left + 20, clientY: y }));
    ev("pointerdown", r.top + 10);
    ev("pointermove", r.top - 280);
    ev("pointerup", r.top - 280);
    return { antes, depois: folha.getBoundingClientRect().height, snap: folha.dataset.snap };
  });
  ok(arrasteCliente.depois > arrasteCliente.antes + 40 && arrasteCliente.snap !== "colapsada", "folha do cliente sobe ao arrastar (" + arrasteCliente.snap + ")");

  const moto = await browser.newPage();
  await moto.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await moto.goto("http://127.0.0.1:8082/", { waitUntil: "networkidle2", timeout: 30000 });
  await moto.waitForFunction(() => typeof mostrarCorrida === "function" && typeof interpretarOsrm === "function");
  const nav = await moto.evaluate(async () => {
    const mensagens = [{
      id: "m1", pedido_id: "p1", autor_id: "cliente", texto: "Estou na porta",
      criado_em: new Date().toISOString(), lida_em: null
    }];
    db.from = () => ({
      select() { return this; }, eq() { return this; }, neq() { return this; }, is() { return this; }, order() { return this; },
      insert(row) {
        const salvo = { id: "m2", criado_em: new Date().toISOString(), lida_em: null, ...row };
        mensagens.push(salvo);
        return { select: () => ({ single: async () => ({ data: salvo, error: null }) }) };
      },
      update() { return { eq() { return this; }, neq() { return this; }, is: async () => ({ error: null }) }; },
      then(fn) { return Promise.resolve({ data: mensagens.slice(), error: null, count: 1 }).then(fn); }
    });
    db.channel = () => ({ on() { return this; }, subscribe() { return this; } });
    db.removeChannel = () => {};
    db.rpc = async (fn) => {
      if (fn === "minha_corrida") return { data: [corrida], error: null };
      if (fn === "ganhos") return { data: [], error: null };
      return { data: null, error: null };
    };
    show("telaAuth", false); show("telaApp", true); show("telaTrabalho", true);
    const trava = document.createElement("style");
    trava.textContent = "#telaAuth{display:none !important}#telaApp,#telaTrabalho{display:block !important}";
    document.head.append(trava);
    iniciarMapa();
    const id = "p1";
    usuario = { id: "moto" };
    aprovado = true;
    ocupado = true;
    corrida = {
      id, status: "aceito", item: "Documento", preco: 12,
      retirada: "Rua General Osório · Centro", entrega: "Avenida Bento Gonçalves · Areal",
      ret_lat: -31.752, ret_lng: -52.328, ent_lat: -31.74, ent_lng: -52.32,
      ret_numero: "100", ret_complemento: "em frente à praça", ent_numero: "S/N", ent_complemento: null
    };
    const osrm = { code: "Ok", routes: [{ distance: 400, duration: 80,
      geometry: { coordinates: [[-52.337, -31.765], [-52.328, -31.752]] },
      legs: [{ steps: [
        { distance: 250, name: "Rua General Osório", maneuver: { type: "depart", modifier: "straight", location: [-52.337, -31.765] } },
        { distance: 150, name: "Avenida Bento Gonçalves", maneuver: { type: "turn", modifier: "left", location: [-52.332, -31.758] } },
        { distance: 0, name: "", maneuver: { type: "arrive", modifier: "straight", location: [-52.328, -31.752] } }
      ] }]
    }] };
    ultimaPos = [-31.765, -52.337];
    definirRotaNav(interpretarOsrm(osrm), id + ":ret", Date.now());
    mostrarCorrida();
    await new Promise(r => setTimeout(r, 300));
    const painel = document.querySelector("#telaTrabalho .painel");
    const antes = {
      instrucao: $("navInstrucao").textContent,
      dist: $("navDist").textContent,
      banner: !$("navBanner").classList.contains("hidden"),
      numero: $("lugarNum").textContent,
      comp: $("lugarComp").textContent,
      chatSome: $("btnChat").classList.contains("hidden"),
      waze: !!document.querySelector("button[onclick=\"abrirNavegacao('waze')\"]"),
      snap: painel.dataset.snap,
      extra: getComputedStyle(painel.querySelector(".folha-extra")).display,
      btn: $("corridaBtn").textContent,
      mapH: Math.round($("mapa").getBoundingClientRect().height),
      vh: window.innerHeight,
      etaBottom: Math.round($("navEta").getBoundingClientRect().bottom),
      folhaTop: Math.round(painel.getBoundingClientRect().top),
      pitch: mapa.getPitch(),
      tipo: mapa._eja,
      livre: document.body.classList.contains("mapa-livre"),
      titulo: $("motoStatusTitulo").textContent,
      bussola: $("bussola").textContent.trim()
    };
    const alvo = document.elementFromPoint(180, 240);
    antes.noMapa = !!(alvo && alvo.closest && alvo.closest(".maplibregl-map, .leaflet-container, .eja-marcador"));
    Chat.alternar();
    await new Promise(r => setTimeout(r, 50));
    const lista = $("ejaChatLista") ? $("ejaChatLista").textContent : "";
    $("ejaChatTexto").value = "Pode descer";
    await Chat._enviar();
    return { antes, lista, depois: $("ejaChatLista").textContent, voz: $("navVoz").textContent };
  });
  ok(nav.antes.banner && /Em .+esquerda|Siga/.test(nav.antes.instrucao), "banner com distância até a manobra: " + nav.antes.instrucao);
  ok(nav.antes.dist !== "—", "distância restante: " + nav.antes.dist);
  ok(nav.antes.numero === "nº 100" && /praça/.test(nav.antes.comp), "motoboy vê nº 100 e complemento");
  ok(!nav.antes.chatSome && nav.antes.waze, "chat e botão do Waze existem na corrida");
  ok(nav.antes.snap === "colapsada" && nav.antes.extra === "none", "navegação começa com a folha colapsada");
  ok(/coletei/i.test(nav.antes.btn), "ação da vez fica visível: " + nav.antes.btn);
  ok(nav.antes.mapH >= nav.antes.vh - 8, "mapa do motoboy ocupa a tela (" + nav.antes.mapH + ")");
  ok(nav.antes.etaBottom <= nav.antes.folhaTop + 4, "ETA fica acima da folha");
  ok(/Estou na porta/.test(nav.lista) && /Pode descer/.test(nav.depois), "conversa mostra a mensagem recebida e a enviada");
  ok(nav.voz === "Voz off", "voz começa desligada");
  ok(nav.antes.pitch > 40 && nav.antes.tipo === "gl", "mapa do motoboy em 3D (" + Math.round(nav.antes.pitch) + "°, " + nav.antes.tipo + ")");
  ok(nav.antes.noMapa && !nav.antes.livre && nav.antes.bussola === "↑", "gestos livres e bússola no sentido da moto");
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-chat.png" });
  await moto.evaluate(() => Chat._fechar());
  const centroMoto = await moto.evaluate(() => mapa.getCenter());
  const caixaMoto = await moto.$("#mapa").then(el => el.boundingBox());
  await moto.mouse.move(caixaMoto.x + 180, caixaMoto.y + 240);
  await moto.mouse.down();
  await moto.mouse.move(caixaMoto.x + 40, caixaMoto.y + 420, { steps: 12 });
  await moto.mouse.up();
  await moto.waitForFunction(() => document.body.classList.contains("mapa-livre"), { timeout: 2000 }).catch(() => {});
  const panMoto = await moto.evaluate(() => {
    const c = mapa.getCenter();
    Nav.ultimoRumo = 90;
    return {
      lat: c.lat, lng: c.lng,
      livre: document.body.classList.contains("mapa-livre"),
      fab: getComputedStyle(document.querySelector("#telaTrabalho .fab-tr")).display
    };
  });
  const motoMudou = Math.abs(panMoto.lat - centroMoto.lat) > 0.0003 || Math.abs(panMoto.lng - centroMoto.lng) > 0.0003;
  ok(motoMudou && panMoto.livre && panMoto.fab !== "none", "arrastar o mapa do motoboy muda o centro e mostra recentralizar");
  await moto.evaluate(() => { alternarBussola(); });
  const norte = await moto.evaluate(() => ({ texto: $("bussola").textContent.trim(), norte: $("bussola").classList.contains("norte"), bearing: mapa.getBearing() }));
  ok(norte.texto === "N" && norte.norte && Math.abs(norte.bearing) < 1, "bússola alterna para o norte (" + norte.bearing.toFixed(0) + "°)");
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-nav-360.png" });
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-nav.png" });
  const arrasteMoto = await moto.evaluate(() => {
    const folha = document.querySelector("#telaTrabalho .painel");
    const antes = folha.getBoundingClientRect().height;
    const alca = folha.querySelector(".alca");
    const r = alca.getBoundingClientRect();
    const ev = (tipo, y) => alca.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", button: 0, clientX: r.left + 30, clientY: y }));
    ev("pointerdown", r.top + 8);
    ev("pointermove", r.top - 320);
    ev("pointerup", r.top - 320);
    const extra = getComputedStyle(folha.querySelector(".folha-extra")).display;
    return { antes, depois: Math.round(folha.getBoundingClientRect().height), snap: folha.dataset.snap, extra };
  });
  ok(arrasteMoto.depois > arrasteMoto.antes + 40 && arrasteMoto.snap !== "colapsada" && arrasteMoto.extra !== "none", "arrastar a alça abre endereço, chat e Waze (" + arrasteMoto.snap + ")");
  await moto.setViewport({ width: 800, height: 1280, isMobile: true, hasTouch: true });
  await moto.evaluate(() => new Promise(r => setTimeout(r, 350)));
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-nav-grande.png" });
  await moto.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await moto.evaluate(() => { folhaIr(document.querySelector("#telaTrabalho .painel"), 0); return new Promise(r => setTimeout(r, 250)); });
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-nav-colapsada.png" });
} finally {
  await browser.close();
}

if (falhas.length) {
  console.error(falhas.length + " verificação(ões) falharam");
  process.exit(1);
}
console.log("ui_check: ok");
