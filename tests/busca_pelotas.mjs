// Consulta de verdade no Photon (e no Nominatim só se o Photon vier vazio).
// node tests/busca_pelotas.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, Date, Math, Object, isFinite, Number, setTimeout, clearTimeout, fetch, AbortController });
vm.runInContext(fs.readFileSync("apps/shared/geo.js", "utf8"), context, { filename: "geo.js" });
context.PELOTAS = [-31.7719, -52.3426];

const consultas = [
  ["Av Brasil 1234", /avenida brasil/i, "1234"],
  ["Rua XV de Novembro", /quinze de novembro/i, ""],
  ["Av Bento Gonçalves", /bento gon[cç]alves/i, ""],
  ["Rodoviária", /rodovi[aá]ria|esta[cç][aã]o rodovi/i, ""],
  ["estacao", /esta[cç][aã]o|rodovi[aá]ria/i, ""]
];

const relatorio = [];
for (const [q, re, numero] of consultas) {
  let lista = [];
  let erro = "";
  try {
    lista = await vm.runInContext(`buscarEnderecos(${JSON.stringify(q)}, { bias: [-31.765, -52.337] })`, context);
  } catch (e) {
    erro = e && e.message || String(e);
  }
  const topo = (lista || []).slice(0, 3).map(e => `${e.titulo || e.nome} | ${e.subtitulo || ""}`);
  const ok = !erro && (lista || []).some(e => re.test((e.titulo || "") + " " + (e.nome || "")));
  const numOk = !numero || (lista || []).some(e => e.numero === numero && re.test(e.nome || ""));
  relatorio.push({ q, ok: ok && numOk, erro, topo, numero: (lista[0] && lista[0].numero) || "" });
  console.log((ok && numOk ? "ok  " : "FALHA ") + q + (erro ? " (" + erro + ")" : "") + " → " + (topo.join(" || ") || "(vazio)"));
  await new Promise(r => setTimeout(r, 700));
}

const falhas = relatorio.filter(r => !r.ok);
if (falhas.length) {
  console.error(falhas.length + " consulta(s) não voltaram como esperado");
  process.exit(1);
}
console.log("busca_pelotas: ok");
