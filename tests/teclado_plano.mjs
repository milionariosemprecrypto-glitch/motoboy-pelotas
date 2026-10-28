// A caixa de "Planeje sua entrega" não pode encolher em nenhum dos dois jeitos
// que o teclado do Android aparece: a janela encolhe, ou o visualViewport encolhe
// e a janela fica do mesmo tamanho. Rode com o cliente em http://127.0.0.1:8091/
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("/tmp/pglite-harness/package.json");
const puppeteer = require("puppeteer-core");

const DIR = "/opt/cursor/artifacts";
mkdirSync(DIR, { recursive: true });

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
function quase(a, b, t = 1) { return Math.abs(a - b) <= t; }

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => localStorage.setItem("eja_onboarding_ok", "true"));
  await page.goto("http://127.0.0.1:8091/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => typeof encaixarBusca === "function" && document.getElementById("telaPlano"));

  const medir = () => page.evaluate(() => {
    const caixa = document.querySelector("#telaPlano .caixa-rota");
    const origem = document.getElementById("origem");
    const destino = document.getElementById("destino");
    const lista = document.getElementById("sugDestino");
    const bloco = document.getElementById("blocoSalvar");
    const r = el => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height, left: b.left, width: b.width };
    };
    const visiveis = [...document.querySelectorAll("#telaPlano input")].filter(el => el.getClientRects().length > 0).map(el => el.id);
    const cs = getComputedStyle(caixa);
    return {
      caixa: r(caixa),
      origem: r(origem),
      destino: r(destino),
      caixaCss: cs.height,
      listaMax: lista.style.maxHeight,
      blocoDisplay: getComputedStyle(bloco).display,
      visiveis,
      debug: document.getElementById("planoDebug").classList.contains("hidden"),
      inner: window.innerHeight,
      vv: window.visualViewport ? window.visualViewport.height : null
    };
  });

  await page.evaluate(() => {
    document.getElementById("telaApp").classList.remove("hidden");
    document.querySelectorAll(".tela").forEach(t => t.classList.add("hidden"));
    const tela = document.getElementById("telaPlano");
    tela.classList.remove("hidden");
    tela.classList.remove("plano-salvar");
    document.documentElement.classList.add("plano-aberto");
    document.body.classList.add("sem-nav");
    document.getElementById("origem").value = "Rua General Osório, 100";
    document.getElementById("destino").value = "Av Bento Gonçalves";
    document.getElementById("destino").focus();
    tela.dataset.foco = "destino";
    const lista = document.getElementById("sugDestino");
    lista.innerHTML = "";
    ["Av. Bento Gonçalves, 1500 — Centro", "Av. Bento Gonçalves, 2200 — Areal", "Av. Bento Gonçalves, 3180 — Fragata", "Rua Bento Gonçalves, 40 — Porto", "Av. Bento Gonçalves, 4500 — Laranjal", "Av. Bento Gonçalves, 90 — Centro"].forEach(t => {
      const b = document.createElement("button");
      b.className = "sugestao";
      b.type = "button";
      b.textContent = t;
      b.style.cssText = "display:block;width:100%;text-align:left;padding:14px 8px;background:#fff;border:0;border-bottom:1px solid #eee;font:16px Poppins,sans-serif;";
      lista.append(b);
    });
    document.documentElement.classList.add("eja-debug");
    marcarVersaoDebug();
    encaixarBusca(document.getElementById("destino"));
  });

  const base = await medir();
  ok(base.caixaCss === "112px", "caixa com 112px no layout cheio (" + base.caixaCss + ")");
  ok(quase(base.origem.height, 44) && quase(base.destino.height, 44), "campos com 44px (" + base.origem.height + " / " + base.destino.height + ")");
  ok(base.destino.top >= base.origem.bottom - 0.5, "campos não se sobrepõem no layout cheio");
  ok(base.destino.top - base.origem.bottom >= 4, "há espaço entre os campos (" + (base.destino.top - base.origem.bottom) + "px)");
  ok(base.visiveis.join(",") === "origem,destino", "só os dois campos da rota estão visíveis (" + base.visiveis.join(",") + ")");
  ok(base.blocoDisplay === "none", "Número/Complemento fora desta tela");
  ok(base.debug === false, "selo v1.7 visível no modo debug");

  // Modo 1: o teclado encolhe a janela para 340px.
  await page.setViewport({ width: 360, height: 340, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluate(() => encaixarBusca(document.getElementById("destino")));
  const janela = await medir();
  ok(janela.inner <= 360, "janela encolheu (" + janela.inner + ")");
  ok(quase(janela.caixa.height, base.caixa.height) && janela.caixaCss === "112px", "caixa não encolheu com a janela em 340px (" + janela.caixa.height + ")");
  ok(quase(janela.origem.height, base.origem.height) && quase(janela.destino.height, base.destino.height), "altura dos campos igual com a janela encolhida");
  ok(quase(janela.origem.top, base.origem.top) && quase(janela.destino.top, base.destino.top), "posição dos campos igual com a janela encolhida");
  ok(janela.destino.top >= janela.origem.bottom - 0.5, "campos não se sobrepõem com a janela em 340px");
  await page.screenshot({ path: DIR + "/teclado-janela-340.png" });

  // Modo 2: a janela continua em 640 e só o visualViewport encolhe.
  await page.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const trocou = await page.evaluate(() => {
    const real = window.visualViewport;
    let encolhido = false;
    const falso = {
      get height() { return encolhido ? 340 : real.height; },
      get width() { return real.width; },
      get offsetTop() { return 0; },
      get offsetLeft() { return real.offsetLeft || 0; },
      get pageTop() { return 0; },
      get pageLeft() { return real.pageLeft || 0; },
      get scale() { return real.scale || 1; },
      addEventListener: (...a) => real.addEventListener(...a),
      removeEventListener: (...a) => real.removeEventListener(...a),
      dispatchEvent: (...a) => real.dispatchEvent(...a)
    };
    try {
      Object.defineProperty(window, "visualViewport", { configurable: true, get: () => falso });
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
    encolhido = true;
    encaixarBusca(document.getElementById("destino"));
    let faixa = document.getElementById("faixaTeclado");
    if (!faixa) {
      faixa = document.createElement("div");
      faixa.id = "faixaTeclado";
      faixa.textContent = "teclado";
      faixa.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:300px;z-index:4000;pointer-events:none;background:#1c1c1e;color:#fff;display:flex;align-items:center;justify-content:center;font:600 16px Poppins,sans-serif;";
      document.body.append(faixa);
    }
    return { ok: true, vv: window.visualViewport.height, inner: window.innerHeight };
  });
  ok(trocou.ok === true, "visualViewport substituído sem redimensionar a janela" + (trocou.erro ? " (" + trocou.erro + ")" : ""));
  ok(trocou.inner >= 600 && trocou.vv === 340, "janela segue alta e o viewport visual está em 340 (" + trocou.inner + " / " + trocou.vv + ")");
  const overlay = await medir();
  ok(quase(overlay.caixa.height, base.caixa.height) && overlay.caixaCss === "112px", "caixa não encolheu com visualViewport em 340 (" + overlay.caixa.height + ")");
  ok(quase(overlay.origem.height, base.origem.height) && quase(overlay.destino.height, base.destino.height), "altura dos campos igual com o viewport visual encolhido");
  ok(quase(overlay.origem.top, base.origem.top) && quase(overlay.destino.top, base.destino.top), "posição dos campos igual com o viewport visual encolhido");
  ok(overlay.destino.top >= overlay.origem.bottom - 0.5, "campos não se sobrepõem com o viewport visual encolhido");
  const maxLista = parseFloat(overlay.listaMax);
  ok(maxLista >= 96 && maxLista <= 480, "lista limitada ao espaço acima do teclado (" + overlay.listaMax + ")");
  await page.screenshot({ path: DIR + "/teclado-viewport-overlay.png" });
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
console.log("\nteclado da tela de planejamento ok");
