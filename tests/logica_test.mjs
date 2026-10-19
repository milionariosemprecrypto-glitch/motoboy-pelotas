// Funções puras de endereço e navegação (sem navegador). node tests/logica_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, Date, Math, Object, isFinite, Number });
for (const f of ["apps/shared/geo.js", "apps/shared/navegacao.js", "apps/shared/chat.js"]) {
  vm.runInContext(fs.readFileSync(f, "utf8"), context, { filename: f });
}
function run(code) { return vm.runInContext(code, context, { filename: "assert.js" }); }

const casosNumero = run(`([
  validarDetalhe("", false, ""),
  validarDetalhe("  ", true, ""),
  validarDetalhe("s/n", false, ""),
  validarDetalhe("120", false, "  portão azul  "),
  validarDetalhe("12-B", false, ""),
  validarDetalhe("!!", false, ""),
  validarDetalhe("12345678901", false, ""),
  validarDetalhe("10", false, "x".repeat(81))
])`);
assert.equal(casosNumero[0].ok, false);
assert.equal(casosNumero[1].numero, "S/N");
assert.equal(casosNumero[1].complemento, null);
assert.equal(casosNumero[2].numero, "S/N");
assert.deepEqual({ n: casosNumero[3].numero, c: casosNumero[3].complemento }, { n: "120", c: "portão azul" });
assert.equal(casosNumero[4].ok, true);
assert.equal(casosNumero[5].ok, false);
assert.equal(casosNumero[6].ok, false);
assert.equal(casosNumero[7].ok, false);
assert.equal(run(`textoEndereco("Rua A · Centro", "120", "fundos")`), "Rua A · Centro, nº 120 — fundos");
assert.equal(run(`textoEndereco("Rua A", "S/N", null)`), "Rua A, S/N");
assert.equal(run(`textoEndereco("Rua A", null, null)`), "Rua A");

const osrm = {
  code: "Ok",
  routes: [{
    distance: 200, duration: 40,
    geometry: { coordinates: [[-52.34, -31.77], [-52.341, -31.771]] },
    legs: [{ steps: [
      { distance: 150, name: "", maneuver: { type: "depart", modifier: "straight", location: [-52.34, -31.77] } },
      { distance: 50, name: "Rua A", maneuver: { type: "turn", modifier: "left", location: [-52.3405, -31.7705] } },
      { distance: 0, name: "Rua B", maneuver: { type: "arrive", modifier: "straight", location: [-52.341, -31.771], exit: 2 } }
    ] }]
  }]
};
context.osrm = osrm;
assert.equal(run(`instrucaoOsrm(osrm.routes[0].legs[0].steps[1])`), "Vire à esquerda na Rua A");
assert.equal(run(`instrucaoOsrm({ name: "", maneuver: { type: "roundabout", exit: 2, modifier: "straight" } })`), "Na rotatória, pegue a 2ª saída");
assert.equal(run(`instrucaoOsrm({ name: "Rua Fim", maneuver: { type: "arrive", modifier: "straight" } })`), "Você chegou ao destino");
assert.equal(run(`setaOsrm({ type: "turn", modifier: "right" })`), "↱");

const rota = run(`interpretarOsrm(osrm)`);
assert.equal(rota.passos.length, 3);
assert.equal(rota.passos[1].alongM, 150);
assert.equal(rota.linha[0][0], -31.77);

// Linha norte-sul de ~111 m em Pelotas. Meio da linha ~0 m; 0,001° a leste ~90 m.
run(`Nav.limpar && 0`);
const projMeio = run(`projetarNaLinha(-31.7705, -52.34, [[-31.77,-52.34],[-31.771,-52.34]])`);
const projFora = run(`projetarNaLinha(-31.7705, -52.341, [[-31.77,-52.34],[-31.771,-52.34]])`);
assert.ok(projMeio.distM < 5, "ponto na linha: " + projMeio.distM);
assert.ok(Math.abs(projMeio.alongM - 55) < 15, "along " + projMeio.alongM);
assert.ok(projFora.distM > 80 && projFora.distM < 130, "fora " + projFora.distM);

assert.equal(run(`deveConsultarOsrm({ destinoMudou: true, agora: 1000, ultima: 900 })`), true);
assert.equal(run(`deveConsultarOsrm({ agora: 1000, ultima: 0 })`), true);
assert.equal(run(`deveConsultarOsrm({ agora: 10000, ultima: 1, distForaM: 200, foraSeguidos: 5 })`), false);
assert.equal(run(`deveConsultarOsrm({ agora: 20000, ultima: 1, distForaM: 200, foraSeguidos: 1 })`), false);
assert.equal(run(`deveConsultarOsrm({ agora: 20000, ultima: 1, distForaM: 200, foraSeguidos: 2 })`), true);
assert.equal(run(`deveConsultarOsrm({ agora: 70000, ultima: 1, distForaM: 0, foraSeguidos: 0 })`), true);

run(`Nav.rota = null; Nav.foraSeguidos = 0; Nav.ultimoFetch = 0;`);
assert.equal(run(`precisaRotaNav(-31.77, -52.34, "p:ret", 1000).buscar`), true);
run(`definirRotaNav(interpretarOsrm(osrm), "p:ret", 1000)`);
assert.equal(run(`precisaRotaNav(-31.77, -52.34, "p:ret", 2000).buscar`), false);
assert.equal(run(`precisaRotaNav(-31.77, -52.34, "p:ent", 2000).forcar`), true);

const painel = run(`painelNav(-31.77, -52.34)`);
assert.equal(painel.instrucao, "Vire à esquerda na Rua A");
assert.ok(painel.restanteM > 0);

assert.match(run(`textoVoz("Vire à esquerda na Rua A", 180, "turn")`), /^Em 180 metros, vire/);
assert.equal(run(`textoVoz("Você chegou ao destino", 10, "arrive")`), "Você chegou ao destino");
assert.match(run(`formatarDistancia(1540)`), /km/);
assert.equal(run(`formatarDuracao(125)`), "2 min");
assert.equal(run(`formatarDuracao(3700)`), "1 h 2 min");

const norte = run(`rumoGraus({lat:0,lng:0},{lat:0.01,lng:0})`);
const leste = run(`rumoGraus({lat:0,lng:0},{lat:0,lng:0.01})`);
assert.ok(norte < 1 || norte > 359, norte);
assert.ok(Math.abs(leste - 90) < 1, leste);

assert.equal(run(`urlMapaExterno("waze", -31.7, -52.3)`), "https://waze.com/ul?ll=-31.7,-52.3&navigate=yes");
assert.match(run(`urlMapaExterno("google", -31.7, -52.3)`), /google\.com\/maps\/dir/);

const bloqueado = await run(`(async () => {
  Nav.ultimoFetch = 0;
  let chamadas = 0;
  const buscar = async () => { chamadas++; return { ok: true, json: async () => osrm }; };
  const a = await buscarRotaNav({lat:-31.77,lng:-52.34},{lat:-31.76,lng:-52.33},{ agora: 5000, buscar });
  const b = await buscarRotaNav({lat:-31.77,lng:-52.34},{lat:-31.76,lng:-52.33},{ agora: 6000, buscar });
  const c = await buscarRotaNav({lat:-31.77,lng:-52.34},{lat:-31.76,lng:-52.33},{ agora: 5000 + Nav.OSRM_MIN_MS, buscar });
  return { chamadas, ok: !!a.rota, travou: b.throttled, deNovo: !!c.rota };
})()`);
assert.equal(bloqueado.chamadas, 2);
assert.equal(bloqueado.ok, true);
assert.equal(bloqueado.travou, true);
assert.equal(bloqueado.deNovo, true);

assert.equal(run(`contarNaoLidas([{autor_id:"a",lida_em:null},{autor_id:"b",lida_em:null},{autor_id:"b",lida_em:"x"}], "a")`), 1);

console.log("logica_test: ok");
