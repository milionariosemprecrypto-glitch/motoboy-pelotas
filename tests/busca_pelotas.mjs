// Consulta de verdade no Photon (e no Nominatim só se o Photon vier vazio).
// node tests/busca_pelotas.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, Date, Math, Object, isFinite, Number, setTimeout, clearTimeout, fetch });
vm.runInContext(fs.readFileSync("apps/shared/geo.js", "utf8"), context, { filename: "geo.js" });
context.PELOTAS = [-31.7719, -52.3426];

const ruas = [
  ["Av Brasil", /avenida brasil/i],
  ["Av. Bento Gonçalves", /bento gon[cç]alves/i],
  ["R. Gonçalves Chaves", /gon[cç]alves chaves/i],
  ["Av. Duque de Caxias", /duque de caxias/i],
  ["Av. Ferreira Viana", /ferreira viana/i]
];

const relatorio = [];
for (const [q, re] of ruas) {
  const lista = await vm.runInContext(`buscarEnderecos(${JSON.stringify(q)})`, context);
  const topo = (lista || []).slice(0, 3).map(e => `${e.nome} (${e.lat.toFixed(4)}, ${e.lng.toFixed(4)})`);
  const ok = (lista || []).some(e => re.test(e.nome));
  relatorio.push({ q, ok, topo });
  console.log((ok ? "ok  " : "FALHA ") + q + " → " + (topo.join(" | ") || "(vazio)"));
}

const falhas = relatorio.filter(r => !r.ok);
if (falhas.length) {
  console.error(falhas.length + " rua(s) não voltaram em Pelotas");
  process.exit(1);
}
console.log("busca_pelotas: ok");
