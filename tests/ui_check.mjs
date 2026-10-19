// Confere no Chrome a tela de número (cliente) e a navegação/chat (motoboy).
// Os apps precisam estar servidos (8081 cliente, 8082 motoboy) e o shared já copiado.
// Não cria pedido nem grava no Supabase: as chamadas de rede do app são trocadas por um banco falso.
import { createRequire } from "node:module";
const require = createRequire("/tmp/pglite-harness/package.json");
const puppeteer = require("puppeteer-core");

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=390,844"]
});
const falhas = [];
function ok(cond, msg) {
  if (!cond) falhas.push(msg);
  console.log((cond ? "ok  " : "FALHA ") + msg);
}

try {
  const cliente = await browser.newPage();
  await cliente.setViewport({ width: 390, height: 844 });
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

  const moto = await browser.newPage();
  await moto.setViewport({ width: 390, height: 844 });
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
    db.rpc = async () => ({ data: null, error: null });
    show("telaAuth", false); show("telaApp", true); show("telaTrabalho", true);
    iniciarMapa();
    const id = "p1";
    usuario = { id: "moto" };
    aprovado = false;
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
    const antes = {
      instrucao: $("navInstrucao").textContent,
      dist: $("navDist").textContent,
      banner: !$("navBanner").classList.contains("hidden"),
      numero: $("lugarNum").textContent,
      comp: $("lugarComp").textContent,
      chatSome: $("btnChat").classList.contains("hidden"),
      waze: !!document.querySelector("button[onclick=\"abrirNavegacao('waze')\"]")
    };
    Chat.alternar();
    await new Promise(r => setTimeout(r, 50));
    const lista = $("ejaChatLista") ? $("ejaChatLista").textContent : "";
    $("ejaChatTexto").value = "Pode descer";
    await Chat._enviar();
    return { antes, lista, depois: $("ejaChatLista").textContent, voz: $("navVoz").textContent };
  });
  ok(nav.antes.banner && /esquerda|Siga/.test(nav.antes.instrucao), "banner de navegação: " + nav.antes.instrucao);
  ok(nav.antes.dist !== "—", "distância restante: " + nav.antes.dist);
  ok(nav.antes.numero === "nº 100" && /praça/.test(nav.antes.comp), "motoboy vê nº 100 e complemento");
  ok(!nav.antes.chatSome && nav.antes.waze, "chat e botão do Waze aparecem na corrida");
  ok(/Estou na porta/.test(nav.lista) && /Pode descer/.test(nav.depois), "conversa mostra a mensagem recebida e a enviada");
  ok(nav.voz === "Voz off", "voz começa desligada");
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-chat.png" });
  await moto.evaluate(() => Chat._fechar());
  await moto.screenshot({ path: "/opt/cursor/artifacts/motoboy-nav.png" });
} finally {
  await browser.close();
}

if (falhas.length) {
  console.error(falhas.length + " verificação(ões) falharam");
  process.exit(1);
}
console.log("ui_check: ok");
