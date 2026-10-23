// Busca com o dono em Turuçu e mapa OpenFreeMap em um endereço real de Pelotas.
// Sirva o cliente em http://127.0.0.1:8091/ (www já com o shared copiado).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const require = createRequire("/tmp/pglite-harness/package.json");
const puppeteer = require("puppeteer-core");

const DIR = "/opt/cursor/artifacts";
mkdirSync(DIR, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--window-size=480,1000"]
});
const falhas = [];
function ok(cond, msg) {
  if (!cond) falhas.push(msg);
  console.log((cond ? "ok  " : "FALHA ") + msg);
  if (!cond) console.log("   detalhe", msg);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on("pageerror", err => console.log("pageerror", err && err.message));
  page.on("console", msg => { if (msg.type() === "error") console.log("console", msg.text().slice(0, 240)); });
  await page.evaluateOnNewDocument(() => localStorage.setItem("eja_onboarding_ok", "true"));
  await page.goto("http://127.0.0.1:8091/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof buscarEnderecos === "function" && typeof criarMapa === "function" && document.getElementById("telaPlano"));

  await page.evaluate(() => {
    document.getElementById("telaApp").classList.remove("hidden");
    document.querySelectorAll(".tela").forEach(t => t.classList.add("hidden"));
    aqui = { lat: -31.417, lng: -52.18, nome: "Avenida Arthur Lange", numero: "S/N", complemento: "", fora: true };
    window.__logs = [];
    const orig = window.fetch;
    window.fetch = async (url, init) => {
      try {
        const res = await orig(url, init);
        window.__logs.push(res.status + " " + String(url).slice(0, 110));
        return res;
      } catch (e) {
        window.__logs.push("THROW " + (e && e.name) + " " + (e && e.message) + " " + String(url).slice(0, 80));
        throw e;
      }
    };
    ligarBusca();
    abrirPlano();
    aplicarGpsNoPlano();
    document.documentElement.classList.add("eja-debug");
    marcarVersaoDebug();
  });

  const banner = await page.$eval("#avisoAreaPlano", el => ({ oculto: el.classList.contains("hidden"), texto: el.textContent }));
  ok(!banner.oculto && /Fora da área de entrega \(Pelotas\)/.test(banner.texto), "banner de Turuçu visível (" + banner.texto + ")");
  const origem = await page.$eval("#origem", el => ({ valor: el.value, escolhido: el.dataset.escolhido }));
  ok(/Arthur Lange|Minha localização/.test(origem.valor) && origem.escolhido !== "1", "origem mostra o lugar e não confirma fora da área");

  async function digitar(texto, modo) {
    await page.evaluate(async (texto, modo) => {
      const campo = document.getElementById("destino");
      campo.focus();
      if (modo === "gboard") {
        campo.value = "";
        campo.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        campo.dispatchEvent(new CompositionEvent("compositionupdate", { data: texto, bubbles: true }));
      } else if (modo === "poll") {
        campo.value = texto;
      } else {
        campo.value = texto;
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const lista = document.getElementById("sugDestino");
      const fim = Date.now() + 12000;
      while (Date.now() < fim) {
        const t = lista.innerText || "";
        if (t && !/^Buscando/.test(t)) return;
        await new Promise(r => setTimeout(r, 150));
      }
    }, texto, modo || "");
    return page.evaluate(() => {
      const lista = document.getElementById("sugDestino");
      const itens = [...lista.querySelectorAll("button.sugestao")].map(b => ({
        titulo: (b.querySelector("b") && b.querySelector("b").textContent) || b.textContent,
        fora: b.classList.contains("fora"),
        aviso: (b.querySelector(".sug-txt span") && b.querySelector(".sug-txt span").textContent) || ""
      }));
      const estado = document.getElementById("estadoBusca");
      return {
        texto: lista.innerText.slice(0, 400),
        itens,
        foco: document.getElementById("telaPlano").dataset.foco,
        logs: (window.__logs || []).slice(-6),
        estado: estado ? estado.textContent : "",
        display: getComputedStyle(lista).display,
        ativa: lista.classList.contains("ativa"),
        selecionado: campoSel()
      };
      function campoSel() {
        const campo = document.getElementById("destino");
        const n = (campo.value || "").length;
        return n > 0 && campo.selectionStart === 0 && campo.selectionEnd === n;
      }
    });
  }

  const estevao = await digitar("Rua Estevão Cândido Jorge dos Reis, 91", "poll");
  console.log("estevao", JSON.stringify(estevao).slice(0, 700));
  ok(estevao.ativa && estevao.display === "block", "a lista fica visível embaixo da caixa (" + estevao.display + ")");
  ok(!!estevao.estado, "há um estado visível sob o campo (" + estevao.estado + ")");
  ok(!estevao.selecionado, "o texto digitado não fica inteiro selecionado");
  ok(estevao.itens.some(i => /Jorge dos Reis/i.test(i.titulo) && !i.fora), "Rua Estevão Jorge dos Reis em Pelotas aparece com o GPS em Turuçu");
  await page.screenshot({ path: DIR + "/busca-estevao-poll.png" });

  const brasil = await digitar("Av Brasil", "gboard");
  console.log("brasil", JSON.stringify(brasil).slice(0, 700));
  ok(brasil.foco === "destino", "a lista do destino fica visível ao digitar");
  ok(brasil.itens.some(i => /Avenida Brasil/.test(i.titulo) && !i.fora), "Gboard sem input event acha Avenida Brasil em Pelotas");
  await page.click("#planoDebug");
  const painel = await page.$eval("#painelDebugBusca", el => ({ oculto: el.classList.contains("hidden"), texto: el.textContent }));
  ok(!painel.oculto && /lat=-31\.7719/.test(painel.texto) && !/lat=-31\.417/.test(painel.texto), "painel mostra a URL no centro de Pelotas, sem o GPS de Turuçu");
  ok(/compositionupdate/.test(painel.texto), "painel registra o evento do Gboard");
  console.log("painel", painel.texto.slice(0, 500));
  await page.screenshot({ path: DIR + "/busca-turucu-av-brasil.png" });

  const xv = await digitar("Rua XV de Novembro");
  ok(xv.itens.some(i => /Quinze de Novembro/.test(i.titulo) && !i.fora), "Rua XV de Novembro acha a rua em Pelotas");
  await page.screenshot({ path: DIR + "/busca-turucu-xv.png" });

  const rod = await digitar("Rodoviária");
  ok(rod.itens.length > 0, "Rodoviária devolve sugestões (" + rod.itens.length + ")");
  await page.screenshot({ path: DIR + "/busca-turucu-rodoviaria.png" });

  await page.evaluate(() => {
    definirLado("origem", { nome: "Rua General Osório", lat: -31.765, lng: -52.337, numero: "100", bairro: "Centro" });
    const alvo = [...document.querySelectorAll("#sugDestino button.sugestao")].find(b => !b.classList.contains("fora") && /Quinze|Rodovi|Brasil|Terminal|Guanabara/i.test(b.textContent));
    if (alvo) alvo.click();
  });
  await page.waitForFunction(() => {
    const tela = document.getElementById("telaConfirmar");
    return tela && !tela.classList.contains("hidden") && document.querySelector("#mapa canvas, #mapa .leaflet-tile");
  }, { timeout: 15000 }).catch(() => {});

  const criou = await page.evaluate(async () => {
    let erro = "";
    if (document.getElementById("telaConfirmar").classList.contains("hidden")) {
      document.querySelectorAll(".tela").forEach(t => t.classList.add("hidden"));
      document.getElementById("telaPino").classList.remove("hidden");
      document.documentElement.classList.add("plano-aberto");
      try { mapaPino = criarMapa("mapaPino", { rotacao: false, limiteCidade: true, zoom: 16 }); }
      catch (e) { erro = String(e && e.stack || e); }
      if (mapaPino) centralizarPino({ lat: -31.77443, lng: -52.35278 }, 16, 0);
    }
    await new Promise(r => setTimeout(r, 4000));
    return { tem: !!mapaPino, erro, worker: !!window.__ejaWorker, aviso: (document.querySelector(".mapa-estado") || {}).textContent || "" };
  });
  console.log("criou", JSON.stringify(criou));
  await page.screenshot({ path: DIR + "/mapa-pelotas-av-brasil.png" });

  const mapa = await page.evaluate(() => {
    const tela = !document.getElementById("telaConfirmar").classList.contains("hidden") ? "confirmar" : "pino";
    const aviso = document.querySelector(".mapa-estado");
    const vivo = tela === "confirmar" ? (typeof mapa !== "undefined" ? mapa : null) : (typeof mapaPino !== "undefined" ? mapaPino : null);
    const centro = vivo && vivo.getCenter ? vivo.getCenter() : null;
    return {
      tela,
      aviso: aviso ? aviso.textContent : "",
      centro,
      webgl: typeof temWebGL === "function" ? temWebGL() : false,
      worker: !!window.__ejaWorker,
      lib: typeof maplibregl !== "undefined",
      temMapa: !!vivo
    };
  });
  const cores = spawnSync("python3", ["-c", `
from PIL import Image
im = Image.open(${JSON.stringify(DIR + "/mapa-pelotas-av-brasil.png")}).convert("RGB")
w, h = im.size
box = im.crop((w//4, h//4, 3*w//4, 3*h//4))
n = box.getcolors(maxcolors=8000)
print(8000 if n is None else len(n))
`], { encoding: "utf8" });
  const variacao = Number((cores.stdout || "").trim());
  console.log("mapa", JSON.stringify(mapa), "cores", variacao, cores.stderr || "");
  ok(mapa.lib === true && mapa.worker === true, "MapLibre local com worker do app");
  ok(variacao > 30 && !/não carregou/.test(mapa.aviso || ""), "o mapa mostra ruas, não um retângulo liso (" + variacao + " cores)");
  if (mapa.centro) {
    const perto = Math.abs(mapa.centro.lat - (-31.77)) < 0.08 && Math.abs(mapa.centro.lng - (-52.34)) < 0.12;
    ok(perto, "mapa centrado em Pelotas (" + mapa.centro.lat.toFixed(4) + ", " + mapa.centro.lng.toFixed(4) + ")");
  }
} catch (e) {
  falhas.push(String(e && e.stack || e));
  console.error(e);
} finally {
  await browser.close();
}
if (falhas.length) {
  console.error("\n" + falhas.length + " falha(s)");
  process.exit(1);
}
console.log("\nbusca em Turuçu e mapa ok");
