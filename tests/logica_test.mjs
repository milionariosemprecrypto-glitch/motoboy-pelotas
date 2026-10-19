// Funções puras de endereço e navegação (sem navegador). node tests/logica_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, Date, Math, Object, isFinite, Number, setTimeout, clearTimeout });
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
assert.equal(run(`expandirAbrev("Av Brasil")`), "Avenida Brasil");
assert.equal(run(`expandirAbrev("Av. Brasil")`), "Avenida Brasil");
assert.equal(run(`expandirAbrev("R. Gonçalves Chaves")`), "Rua Gonçalves Chaves");
assert.equal(run(`expandirAbrev("est da costa")`), "Estrada da costa");
assert.ok(run(`consultasEndereco("Av Brasil")`).includes("Avenida Brasil"));
assert.ok(run(`consultasEndereco("Av Brasil")`).includes("avenida brasil"));
assert.equal(run(`separarNumero("Av Brasil 1234").numero`), "1234");
assert.equal(run(`separarNumero("Av Brasil 1234").texto`), "Av Brasil");
assert.equal(run(`separarNumero("Av Brasil nº 1500").numero`), "1500");
assert.equal(run(`separarNumero("Av Brasil, 12-B").numero`), "12-B");
assert.equal(run(`separarNumero("Av Brasil 120 - fundos").complemento`), "fundos");
assert.equal(run(`separarNumero("Rua XV de Novembro").numero`), "");
assert.equal(run(`separarNumero("Rua 15 de Novembro").numero`), "");
assert.ok(run(`consultasEndereco("Av Brasil 1234")`).includes("Avenida Brasil"));
assert.ok(!run(`consultasEndereco("Av Brasil 1234")`).some(q => /1234/.test(q)), "o número não vai para o Photon");
assert.ok(run(`consultasEndereco("Rua XV de Novembro")`).some(q => /Quinze de Novembro/.test(q)));
assert.ok(run(`consultasEndereco("estacao")`).some(q => /Rodoviária|Terminal/.test(q)));
assert.equal(run(`cidadePelotas({})`), false);
assert.equal(run(`cidadePelotas({ city: "" })`), false);
assert.equal(run(`cidadePelotas({ city: "São Lourenço do Sul" })`), false);
assert.equal(run(`cidadePelotas({ city: "Pelotas" })`), true);
assert.equal(run(`textoEndereco("Avenida Brasil", "120", null)`), "Avenida Brasil, nº 120");

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
assert.equal(run(`instrucaoOsrm({ name: "Avenida Arthur Lange", maneuver: { type: "continue", modifier: "uturn" } })`), "Faça o retorno na Avenida Arthur Lange");
assert.equal(run(`instrucaoOsrm({ name: "BR-116", maneuver: { type: "uturn", modifier: "uturn" } })`), "Faça o retorno na BR-116");
assert.equal(run(`instrucaoOsrm({ name: "Rua A", maneuver: { type: "end of road", modifier: "left" } })`), "No fim da rua, vire à esquerda na Rua A");
assert.equal(run(`instrucaoOsrm({ name: "Rua B", maneuver: { type: "new name", modifier: "straight" } })`), "Continue em frente na Rua B");
assert.equal(run(`instrucaoOsrm({ name: "", maneuver: { type: "on ramp", modifier: "slight right" } })`), "Pegue a rampa levemente à direita");
assert.equal(run(`setaOsrm({ type: "turn", modifier: "right" })`), "↱");
assert.equal(run(`setaOsrm({ type: "continue", modifier: "uturn" })`), "↩");

const rota = run(`interpretarOsrm(osrm)`);
assert.equal(rota.passos.length, 3);
assert.ok(rota.passos[0].alongM < 5, "partida " + rota.passos[0].alongM);
assert.ok(rota.passos[1].alongM > 20 && rota.passos[1].alongM < rota.passos[2].alongM, "manobra " + rota.passos[1].alongM);
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

const longa = {
  code: "Ok",
  routes: [{
    distance: 1330, duration: 180,
    geometry: { coordinates: [[-52.34, -31.77], [-52.34, -31.766], [-52.34, -31.762], [-52.34, -31.758]] },
    legs: [{ steps: [
      { distance: 445, name: "Rua de saída", maneuver: { type: "depart", modifier: "straight", location: [-52.34, -31.77] } },
      { distance: 445, name: "Avenida Arthur Lange", maneuver: { type: "continue", modifier: "uturn", location: [-52.34, -31.766] } },
      { distance: 440, name: "BR-116", maneuver: { type: "turn", modifier: "right", location: [-52.34, -31.762] } },
      { distance: 0, name: "", maneuver: { type: "arrive", modifier: "straight", location: [-52.34, -31.758] } }
    ] }]
  }]
};
context.longa = longa;
run(`definirRotaNav(interpretarOsrm(longa), "p:ent", 9000)`);
const noInicio = run(`painelNav(-31.77, -52.34)`);
assert.match(noInicio.instrucao, /Faça o retorno na Avenida Arthur Lange/);
assert.ok(noInicio.metrosManobra > 300, "distância até o retorno " + noInicio.metrosManobra);
assert.match(run(`textoManobra(${JSON.stringify(noInicio.instrucao)}, ${noInicio.metrosManobra}, ${JSON.stringify(noInicio.tipo)})`), /^Em \d+ m faça o retorno/);
const depois = run(`painelNav(-31.764, -52.34)`);
assert.match(depois.instrucao, /Vire à direita na BR-116/);
assert.ok(depois.metrosManobra > 80 && depois.metrosManobra < 400, "avançou para a próxima manobra " + depois.metrosManobra);
assert.match(run(`textoManobra(${JSON.stringify(depois.instrucao)}, ${depois.metrosManobra}, ${JSON.stringify(depois.tipo)})`), /^Em \d+ m vire à direita/);

assert.match(run(`textoVoz("Vire à esquerda na Rua A", 180, "turn")`), /^Em 180 metros, vire/);
assert.equal(run(`textoManobra("Vire à esquerda na Rua A", 200, "turn")`), "Em 200 m vire à esquerda na Rua A");
assert.equal(run(`textoManobra("Você chegou ao destino", 10, "arrive")`), "Você chegou ao destino");
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

const buscaMock = await run(`(async () => {
  const urls = [];
  const buscar = async (url, opts) => {
    urls.push({ url: String(url), ua: opts && opts.headers && opts.headers["User-Agent"] || "" });
    if (String(url).includes("nominatim")) {
      return { ok: true, json: async () => [{ lat: "-31.774", lon: "-52.353", name: "Avenida Brasil", address: { road: "Avenida Brasil", city: "Pelotas", suburb: "Centro" } }] };
    }
    return { ok: true, json: async () => ({ features: [] }) };
  };
  const lista = await buscarEnderecos("Av Brasil", buscar);
  return { urls, nome: lista[0] && lista[0].nome };
})()`);
assert.ok(buscaMock.urls.some(u => /photon/.test(u.url) && /Avenida%20Brasil/.test(u.url) && !/Pelotas/.test(u.url)), "Photon não recebe o sufixo Pelotas");
assert.ok(buscaMock.urls.some(u => /nominatim/.test(u.url) && /E-Ja/.test(u.ua)), "Nominatim só entra se o Photon vier vazio, com User-Agent");
assert.match(buscaMock.nome, /Avenida Brasil/);

const comNumero = await run(`(async () => {
  const buscar = async (url) => {
    if (String(url).includes("nominatim")) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ features: [{
      geometry: { coordinates: [-52.352, -31.774] },
      properties: { name: "Avenida Brasil", housenumber: "50", district: "Centro", city: "Pelotas", state: "Rio Grande do Sul", postcode: "96025-000", osm_key: "highway", osm_value: "secondary" }
    }] }) };
  };
  const lista = await buscarEnderecos("Av Brasil 1234", { buscar, bias: [-31.77, -52.34] });
  return lista[0];
})()`);
assert.equal(comNumero.numero, "1234");
assert.equal(comNumero.nome, "Avenida Brasil");
assert.ok(!/, 50|, 1234/.test(comNumero.nome), "nome sem número duplicado");
assert.match(comNumero.titulo, /^Avenida Brasil, 1234/);
assert.match(comNumero.subtitulo, /Pelotas - RS/);
assert.match(comNumero.subtitulo, /96025-000/);
assert.equal(run(`textoEndereco(${JSON.stringify(comNumero.nome)}, ${JSON.stringify(comNumero.numero)}, null)`), "Avenida Brasil, nº 1234");

const semCidade = await run(`(async () => {
  const buscar = async (url) => {
    if (String(url).includes("nominatim")) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ features: [{
      geometry: { coordinates: [-52.34, -31.77] },
      properties: { name: "Rua Sem Cidade", city: "", osm_key: "highway", osm_value: "residential" }
    }] }) };
  };
  return (await buscarEnderecos("Rua Sem Cidade", buscar)).length;
})()`);
assert.equal(semCidade, 0);

console.log("logica_test: ok");
