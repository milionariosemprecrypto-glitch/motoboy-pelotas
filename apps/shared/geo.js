// Busca de endereços (Photon/OSM, com Nominatim se o Photon vier vazio) e rota de rua (OSRM).
// ATENÇÃO: os servidores públicos gratuitos têm limite de uso e não garantem disponibilidade.
// Nominatim: no máximo 1 consulta por segundo. O User-Agent do WebView já identifica o app;
// o header User-Agent no fetch é proibido e faz o pedido falhar.
// A área que confirma é AREA_ENTREGA (config.js). A busca mostra um retângulo maior em volta.
const MARGEM_BUSCA = 0.45;
const NOMINATIM_INTERVALO_MS = 1100;
const BUSCA_DEBOUNCE_MS = 160;
let nominatimLivreEm = 0;

function bboxEntrega() {
  if (typeof AREA_ENTREGA !== "undefined" && AREA_ENTREGA && AREA_ENTREGA.bbox && AREA_ENTREGA.bbox.length === 4) return AREA_ENTREGA.bbox;
  return [-52.60, -31.96, -52.02, -31.50];
}
const PELOTAS_BBOX = bboxEntrega();
function nomeArea() {
  return (typeof AREA_ENTREGA !== "undefined" && AREA_ENTREGA && AREA_ENTREGA.nome) || "Pelotas";
}
function textoFora() {
  return "Fora da área de entrega (" + nomeArea() + ") — distância não permitida";
}
function bboxBusca() {
  const [o, s, l, n] = PELOTAS_BBOX;
  return [o - MARGEM_BUSCA, s - MARGEM_BUSCA, l + MARGEM_BUSCA, n + MARGEM_BUSCA];
}
function dentroCaixa(lat, lng, caixa) {
  const [o, s, l, n] = caixa;
  return lng >= o && lng <= l && lat >= s && lat <= n;
}
function dentroPelotas(lat, lng) { return dentroCaixa(lat, lng, PELOTAS_BBOX); }
function dentroBusca(lat, lng) { return dentroCaixa(lat, lng, bboxBusca()); }

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// "Av Brasil" -> "Avenida Brasil". Só troca a palavra inteira (av, r., trav, est, pc, dr, gen, cel…).
const ABREV_ENDERECO = {
  av: "Avenida", avenida: "Avenida",
  r: "Rua", rua: "Rua",
  trav: "Travessa", tv: "Travessa", travessa: "Travessa",
  est: "Estrada", estrada: "Estrada",
  pc: "Praça", pca: "Praça", "pça": "Praça", praca: "Praça", "praça": "Praça",
  dr: "Doutor", doutor: "Doutor", dra: "Doutora", doutora: "Doutora",
  gen: "General", general: "General",
  cel: "Coronel", coronel: "Coronel",
  mal: "Marechal", marechal: "Marechal",
  pres: "Presidente", presidente: "Presidente",
  prof: "Professor", professor: "Professor", profa: "Professora", professora: "Professora",
  visc: "Visconde", visconde: "Visconde",
  brg: "Brigadeiro", brigadeiro: "Brigadeiro",
  cap: "Capitão", capitao: "Capitão", "capitão": "Capitão",
  ten: "Tenente", tenente: "Tenente",
  alm: "Alameda", alameda: "Alameda",
  rod: "Rodovia", rodovia: "Rodovia",
  bc: "Beco", beco: "Beco",
  lg: "Largo", largo: "Largo"
};

function expandirAbrev(texto) {
  return String(texto || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean).map(p => {
    const chave = semAcento(p).replace(/\.$/, "");
    return ABREV_ENDERECO[chave] || p;
  }).join(" ");
}

// No OSM de Pelotas a rua é "Rua Quinze de Novembro", não "Rua XV". O número da casa não entra aqui.
const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21, xxv: 25, xxxi: 31 };
const CARDINAIS = {
  1: "Primeiro", 2: "Dois", 3: "Três", 4: "Quatro", 5: "Cinco", 6: "Seis", 7: "Sete", 8: "Oito", 9: "Nove",
  10: "Dez", 11: "Onze", 12: "Doze", 13: "Treze", 14: "Catorze", 15: "Quinze", 16: "Dezesseis", 17: "Dezessete",
  18: "Dezoito", 19: "Dezenove", 20: "Vinte", 21: "Vinte e Um", 25: "Vinte e Cinco", 31: "Trinta e Um"
};

function expandirNomesDeRua(texto) {
  const t = expandirAbrev(texto);
  return t.replace(/\b([ivxlcdm]+|\d{1,2})(?=\s+de\s+)/gi, tok => {
    const low = semAcento(tok);
    const n = /^\d+$/.test(low) ? Number(low) : ROMANOS[low];
    return n && CARDINAIS[n] ? CARDINAIS[n] : tok;
  });
}

// "Av Brasil 1234", "Av Brasil, nº 1500" e "Rua X 12-B - fundos". "Rua XV de Novembro" não tem número.
function separarNumero(texto) {
  let t = String(texto || "").trim().replace(/\s+/g, " ");
  const num = "(\\d{1,5}(?:[A-Za-z]|[\\/\\-][0-9A-Za-z]{1,4})?)";
  const pref = "(?:(?:n[º°o.]|n[uú]mero|num\\.?)\\s*)?";
  const meio = t.match(new RegExp("^(.*?)(?:,\\s*|\\s+)" + pref + num + "(?:\\s*,\\s+|\\s+[-–—]\\s+)(.+)$", "i"));
  if (meio && meio[1].trim().split(/\s+/).length >= 2) {
    return { texto: meio[1].trim(), numero: meio[2], complemento: meio[3].trim() };
  }
  const fim = t.match(new RegExp("^(.*?)(?:,\\s*|\\s+)" + pref + num + "$", "i"));
  if (fim && fim[2] && fim[1].trim().split(/\s+/).length >= 2) {
    return { texto: fim[1].trim(), numero: fim[2], complemento: "" };
  }
  return { texto: t, numero: "", complemento: "" };
}

function consultasEndereco(texto) {
  const sep = separarNumero(texto);
  const cheio = expandirNomesDeRua(sep.texto);
  const sem = semAcento(cheio);
  const lista = [];
  [cheio, sem].forEach(q => { if (q && lista.indexOf(q) < 0) lista.push(q); });
  if (/estac|rodoviar|terminal/.test(semAcento(sep.texto))) {
    ["Terminal Rodoviário", "Rodoviária"].forEach(q => { if (lista.indexOf(q) < 0) lista.push(q); });
  }
  return lista;
}

function cepPelotas(cep) {
  const d = String(cep || "").replace(/\D/g, "");
  if (d.length < 8 || !d.startsWith("960")) return "";
  return d.slice(0, 5) + "-" + d.slice(5);
}
function siglaUf(estado) {
  const s = semAcento(estado);
  if (!s) return "RS";
  if (s === "rio grande do sul") return "RS";
  if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  return String(estado);
}

// Cidade vazia não passa: o bbox encosta em São Lourenço e em outros municípios.
function cidadePelotas(p) {
  const addr = (p && p.address) || {};
  const campos = [p && p.city, p && p.town, p && p.county, p && p.municipality, p && p.state_district,
    addr.city, addr.town, addr.county, addr.municipality];
  const texto = semAcento(campos.filter(Boolean).join(" "));
  if (!texto) return false;
  return texto.indexOf("pelotas") >= 0;
}

function centroPelotas() {
  return (typeof PELOTAS !== "undefined" && PELOTAS) || [-31.7719, -52.3426];
}
function lerCentro(bias) {
  if (!bias) return null;
  const lat = isFinite(bias.lat) ? Number(bias.lat) : Number(bias[0]);
  const lng = isFinite(bias.lng) ? Number(bias.lng) : Number(bias[1]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return [lat, lng];
}
// O GPS só entra se estiver dentro da área. Fora dela (Turuçu, por exemplo)
// a busca dos dois campos usa o centro de Pelotas. O GPS só preenche a retirada.
function centroBusca(bias) {
  const c = lerCentro(bias);
  if (c && dentroPelotas(c[0], c[1])) return c;
  return centroPelotas();
}

function distMetros(lat, lng, centro) {
  const dLat = (lat - centro[0]) * 111000;
  const dLng = (lng - centro[1]) * 111000 * Math.cos(centro[0] * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}

// Nome sem o número da casa. O número viaja no campo `numero`, para não sair "Rua X, 120, nº 120".
function rotuloAmigavel(p) {
  const nome = String((p && (p.name || p.street)) || "");
  const n = semAcento(nome);
  const valor = (p && p.osm_value) || (p && p.type) || "";
  const chave = (p && p.osm_key) || (p && p.class) || "";
  if (/terminal rodovi|eterpel/.test(n) || n === "rodoviaria") {
    return { nome: "Estação Rodoviária de Pelotas", tipo: "poi" };
  }
  const ruaOsm = /^(residential|primary|secondary|tertiary|trunk|living_street|unclassified|pedestrian|service|road)$/.test(valor);
  if (chave === "highway" && ruaOsm) return { nome: p.name || p.street || nome, tipo: "rua" };
  if (p && p.name && p.street && p.name !== p.street) return { nome: p.name, tipo: "poi" };
  if (chave === "highway" || chave === "place") return { nome: nome, tipo: chave === "place" ? "poi" : "rua" };
  return { nome: nome, tipo: "poi" };
}

function linhasEndereco(e) {
  const num = e.numero && e.numero !== "S/N" ? e.numero : "";
  const base = String(e.nome || "").trim();
  const comNum = num ? base + ", " + num : base;
  const titulo = e.bairro ? comNum + ", " + e.bairro : comNum;
  const cidade = e.cidade || "Pelotas";
  const uf = e.uf || "RS";
  const lugar = [cidade + " - " + uf, e.cep || ""].filter(Boolean).join(", ");
  let dist = "";
  if (e.distM != null && isFinite(e.distM)) {
    dist = e.distM < 950 ? Math.max(1, Math.round(e.distM)) + " m" : (e.distM / 1000).toFixed(1).replace(".", ",") + " km";
  }
  return { titulo, subtitulo: [lugar, dist].filter(Boolean).join(" · ") };
}

function filtrarRuidos(lista, consulta) {
  const q = semAcento(expandirNomesDeRua(separarNumero(consulta).texto || consulta));
  if (!q) return lista;
  const temPrincipal = lista.some(e => {
    const n = semAcento(e.nome);
    return n === q || n.indexOf(q) === 0;
  });
  if (!temPrincipal) return lista;
  return lista.filter(e => {
    const n = semAcento(e.nome);
    return n.indexOf(q) !== -1 ? n.indexOf(q) === 0 : true;
  });
}
function deduplicarEnderecos(lista) {
  const vistos = {};
  return lista.filter(e => {
    const chave = semAcento(e.nome) + "|" + semAcento(e.bairro || "");
    if (vistos[chave]) return false;
    vistos[chave] = true;
    return true;
  });
}

function ordenarEnderecos(lista, consulta, bias) {
  const sep = separarNumero(consulta);
  const q = semAcento(expandirNomesDeRua(sep.texto || consulta));
  const tokens = q.split(" ").filter(t => t.length > 2);
  const centro = centroBusca(bias);
  const ruaPedida = /^(rua|avenida|travessa|estrada|rodovia|praca|alameda|beco)\b/.test(q);
  return lista.slice().sort((a, b) => pontuar(b) - pontuar(a));
  function pontuar(e) {
    const n = semAcento(e.nome);
    let s = 0;
    if (n === q) s += 220;
    else if (n.indexOf(q) === 0) s += 150;
    else if (q && n.indexOf(q) >= 0) s += 80;
    if (q && n.indexOf(q) >= 0) {
      const extra = n.replace(q, " ").trim();
      if (extra) s -= Math.min(48, extra.split(/\s+/).filter(Boolean).length * 14);
    }
    tokens.forEach(t => { if (n.indexOf(t) >= 0) s += 12; });
    if (!e.fora) s += 80;
    if (e.tipo === "rua" && ruaPedida) s += 28;
    if (e.tipo === "poi" && !ruaPedida) s += 18;
    if (e.osmValue === "bus_station" && /estac|rodoviar|terminal/.test(q)) s += 70;
    e.distM = distMetros(e.lat, e.lng, centro);
    return s - e.distM / 700;
  }
}

function deFeature(p, lng, lat, descartes) {
  function drop(msg) {
    if (descartes) descartes.push(msg);
    return null;
  }
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return drop("sem coordenada");
  if (!dentroBusca(lat, lng)) return drop("fora da busca " + Number(lat).toFixed(3) + "," + Number(lng).toFixed(3) + " " + ((p && (p.city || p.name)) || ""));
  const amig = rotuloAmigavel(p);
  if (!amig.nome) return drop("sem nome");
  const fora = !dentroPelotas(lat, lng);
  return {
    nome: amig.nome,
    tipo: amig.tipo,
    bairro: p.district || p.suburb || p.neighbourhood || p.locality || (p.address && (p.address.suburb || p.address.neighbourhood)) || "",
    cidade: p.city || p.town || (p.address && (p.address.city || p.address.town)) || "Pelotas",
    uf: siglaUf(p.state || (p.address && p.address.state)),
    cep: cepPelotas(p.postcode || (p.address && p.address.postcode)),
    numeroOsm: p.housenumber || (p.address && p.address.house_number) || "",
    numero: "",
    complemento: "",
    lat: Number(lat),
    lng: Number(lng),
    fora: fora,
    osmKey: p.osm_key || p.class || "",
    osmValue: p.osm_value || p.type || ""
  };
}

function opcoesBusca(arg) {
  if (typeof arg === "function") return { buscar: arg, signal: null, bias: null };
  const o = arg || {};
  return {
    buscar: o.buscar || (typeof buscarHttp === "function" ? buscarHttp : (typeof fetch === "function" ? fetch : null)),
    signal: o.signal || null,
    bias: o.bias || null,
    evento: o.evento || "",
    diag: null,
    _retry: !!o._retry
  };
}

const BUSCA_TIMEOUT_MS = 8000;
let transporteBusca = "fetch";

function httpNativo() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.CapacitorHttp) || null;
  } catch (e) { return null; }
}

// No WebView o fetch para o Photon/Nominatim esbarra em CORS (https://localhost).
// O plugin nativo fala direto com o servidor e pode mandar User-Agent, que o Nominatim exige.
async function buscarHttp(url, init) {
  if (init && init.signal && init.signal.aborted) {
    const e = new Error("abort");
    e.name = "AbortError";
    throw e;
  }
  const nativo = httpNativo();
  if (nativo && typeof nativo.get === "function") {
    try {
      const versao = typeof APP_VERSAO !== "undefined" ? APP_VERSAO : "1.11";
      const res = await nativo.get({
        url: String(url),
        headers: {
          "Accept": "application/json",
          "User-Agent": "E-Ja/" + versao + " (entrega em Pelotas; +https://eja-site.pages.dev)",
          "Referer": "https://eja-site.pages.dev/"
        },
        connectTimeout: BUSCA_TIMEOUT_MS,
        readTimeout: BUSCA_TIMEOUT_MS
      });
      transporteBusca = "capacitor-http";
      const status = res && res.status ? Number(res.status) : 0;
      let data = res ? res.data : null;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch (e) {}
      }
      return { ok: status >= 200 && status < 300, status: status, json: async () => data };
    } catch (e) {
      transporteBusca = "fetch";
      const nativoMsg = (e && (e.message || e.errorMessage)) || "capacitor-http";
      try {
        const r = await fetch(url, init);
        transporteBusca = "fetch depois de " + nativoMsg;
        return r;
      } catch (f) {
        const err = f instanceof Error ? f : new Error(String(f || "falha"));
        err.message = "capacitor-http: " + nativoMsg + "; fetch: " + (err.message || "falha");
        err.rede = true;
        throw err;
      }
    }
  }
  transporteBusca = "fetch";
  return fetch(url, init);
}

function publicarDebug(diag) {
  const g = typeof window !== "undefined" ? window : null;
  if (!g || !diag) return;
  g.__ejaUltimaBusca = diag;
  if (typeof g.registrarDebugBusca === "function") {
    try { g.registrarDebugBusca(diag); } catch (e) {}
  }
}

async function buscarUmaVez(op, url, ms, comSignal) {
  const ctrl = comSignal && typeof AbortController === "function" ? new AbortController() : null;
  const onAbort = () => { if (ctrl) ctrl.abort(); };
  if (op.signal && ctrl) {
    if (op.signal.aborted) {
      const e = new Error("abort");
      e.name = "AbortError";
      throw e;
    }
    op.signal.addEventListener("abort", onAbort);
  }
  let timer = null;
  const limite = new Promise((_, rej) => {
    timer = setTimeout(() => {
      if (ctrl) ctrl.abort();
      const err = new Error("tempo");
      err.name = "TimeoutError";
      err.rede = true;
      rej(err);
    }, ms);
  });
  try {
    const init = { headers: { "Accept": "application/json" } };
    if (ctrl) init.signal = ctrl.signal;
    return await Promise.race([op.buscar(url, init), limite]);
  } catch (e) {
    if (e && e.name === "TimeoutError") throw e;
    if (e && e.name === "AbortError") throw e;
    const err = e instanceof Error ? e : new Error(String(e || "falha"));
    err.rede = true;
    throw err;
  } finally {
    clearTimeout(timer);
    if (op.signal && ctrl) op.signal.removeEventListener("abort", onAbort);
  }
}

// Alguns WebViews falham o fetch quando ele vai com AbortSignal. A segunda tentativa vai sem signal.
async function buscarComTempo(op, url, ms) {
  try {
    return await buscarUmaVez(op, url, ms, true);
  } catch (e) {
    if (!e || e.name === "AbortError" || e.name === "TimeoutError") throw e;
    if (abortado(op.signal)) throw e;
    return await buscarUmaVez(op, url, ms, false);
  }
}

function abortado(signal) {
  return !!(signal && signal.aborted);
}

async function photonEnderecos(q, op, comBbox) {
  const centro = centroBusca(op.bias);
  let url = "https://photon.komoot.io/api/?limit=8&lang=default&lat=" + centro[0] + "&lon=" + centro[1] +
    "&q=" + encodeURIComponent(q);
  if (comBbox) url += "&bbox=" + bboxBusca().join(",");
  const chamada = { fonte: "photon", url: url, status: 0, erro: "", brutos: 0, depois: 0, descartes: [] };
  if (op.diag) op.diag.chamadas.push(chamada);
  let json;
  try {
    const r = await buscarComTempo(op, url, BUSCA_TIMEOUT_MS);
    chamada.status = r && r.status ? r.status : 0;
    if (!r || !r.ok) {
      chamada.erro = !r ? "sem resposta" : ("HTTP " + r.status);
      const err = new Error("photon");
      err.rede = true;
      err.status = chamada.status;
      throw err;
    }
    json = typeof r.json === "function" ? await r.json() : r;
  } catch (e) {
    if (!chamada.erro) chamada.erro = e && e.name === "TimeoutError" ? "tempo esgotado (8s)" : ((e && (e.message || e.name)) || "falha");
    throw e;
  }
  const features = (json && json.features) || [];
  chamada.brutos = features.length;
  const itens = [];
  features.forEach(f => {
    const c = (f.geometry && f.geometry.coordinates) || [];
    const item = deFeature(f.properties || {}, c[0], c[1], chamada.descartes);
    if (item) itens.push(item);
  });
  chamada.depois = itens.length;
  return itens;
}

async function nominatimEnderecos(q, op) {
  const agora = Date.now();
  const espera = nominatimLivreEm - agora;
  if (espera > 0) {
    await new Promise((res, rej) => {
      const t = setTimeout(res, espera);
      if (op.signal) op.signal.addEventListener("abort", () => {
        clearTimeout(t);
        const e = new Error("abort");
        e.name = "AbortError";
        rej(e);
      });
    });
  }
  if (abortado(op.signal)) {
    const e = new Error("abort");
    e.name = "AbortError";
    throw e;
  }
  nominatimLivreEm = Date.now() + NOMINATIM_INTERVALO_MS;
  const [o, s, l, n] = bboxBusca();
  const url = "https://nominatim.openstreetmap.org/search?" +
    "format=jsonv2&addressdetails=1&limit=6&countrycodes=br&bounded=0" +
    "&viewbox=" + [o, n, l, s].join(",") +
    "&q=" + encodeURIComponent(q + ", Pelotas, Rio Grande do Sul, Brasil");
  const chamada = { fonte: "nominatim", url: url, status: 0, erro: "", brutos: 0, depois: 0, descartes: [] };
  if (op.diag) op.diag.chamadas.push(chamada);
  let j;
  try {
    const r = await buscarComTempo(op, url, BUSCA_TIMEOUT_MS);
    chamada.status = r && r.status ? r.status : 0;
    if (!r || !r.ok) {
      chamada.erro = !r ? "sem resposta" : ("HTTP " + r.status);
      const err = new Error("nominatim");
      err.rede = true;
      err.status = chamada.status;
      throw err;
    }
    j = typeof r.json === "function" ? await r.json() : r;
  } catch (e) {
    if (!chamada.erro) chamada.erro = e && e.name === "TimeoutError" ? "tempo esgotado (8s)" : ((e && (e.message || e.name)) || "falha");
    throw e;
  }
  const linhas = j || [];
  chamada.brutos = linhas.length;
  const itens = [];
  linhas.forEach(item => {
    const e = deFeature({
      name: item.name || "",
      street: item.address && (item.address.road || item.address.pedestrian),
      district: item.address && (item.address.suburb || item.address.neighbourhood),
      city: item.address && (item.address.city || item.address.town),
      state: item.address && item.address.state,
      postcode: item.address && item.address.postcode,
      housenumber: item.address && item.address.house_number,
      osm_key: item.class,
      osm_value: item.type,
      address: item.address
    }, Number(item.lon), Number(item.lat), chamada.descartes);
    if (e) itens.push(e);
  });
  chamada.depois = itens.length;
  return itens;
}

function temNaArea(lista) {
  return (lista || []).some(e => e && !e.fora);
}

// Não cola "Pelotas" na consulta do Photon: "Av Brasil Pelotas" passa a achar o aeroporto
// e some com a Avenida Brasil. O recorte é o bbox. O viés é Pelotas, nunca um GPS de fora.
async function buscarEnderecos(texto, buscarOuOpts) {
  const op = opcoesBusca(buscarOuOpts);
  const recebido = lerCentro(op.bias);
  const usado = centroBusca(op.bias);
  op.bias = usado;
  const diag = {
    consulta: String(texto || ""),
    evento: op.evento || "",
    biasRecebido: recebido ? recebido[0].toFixed(5) + "," + recebido[1].toFixed(5) : "(nenhum)",
    biasUsado: usado[0].toFixed(5) + "," + usado[1].toFixed(5),
    gpsIgnorado: !!(recebido && (Math.abs(recebido[0] - usado[0]) > 0.01 || Math.abs(recebido[1] - usado[1]) > 0.01)),
    chamadas: [],
    naLista: 0,
    erro: ""
  };
  op.diag = diag;
  try { if (typeof location !== "undefined" && location.origin) diag.origemPagina = location.origin; } catch (e) {}
  try { if (typeof navigator !== "undefined") diag.online = navigator.onLine; } catch (e) {}
  function fim(lista, erro) {
    diag.naLista = lista ? lista.length : 0;
    diag.transporte = transporteBusca;
    if (erro) diag.erro = erro;
    publicarDebug(diag);
    return lista || [];
  }
  if (!op.buscar) return fim([], "sem fetch");
  const sep = separarNumero(texto);
  const consultas = consultasEndereco(texto);
  if (!consultas.length) return fim([]);
  if (abortado(op.signal)) return fim([], "cancelada");
  const principal = consultas[0];
  const paralelas = [principal];
  consultas.forEach(q => {
    if (q === principal || semAcento(q) === semAcento(principal)) return;
    if (paralelas.length < 3) paralelas.push(q);
  });
  let rede = false;
  let achados = [];
  for (const q of paralelas) {
    if (temNaArea(achados) || abortado(op.signal)) break;
    try { achados = achados.concat(await photonEnderecos(q, op, true)); }
    catch (e) {
      if (e && e.name === "AbortError") { fim([], "cancelada"); throw e; }
      rede = true;
    }
  }
  if (!temNaArea(achados) && !abortado(op.signal)) {
    try { achados = achados.concat(await photonEnderecos(principal, op, false)); }
    catch (e) {
      if (e && e.name === "AbortError") { fim([], "cancelada"); throw e; }
      rede = true;
    }
  }
  // Photon vazio, com erro, ou só com vizinhos: Nominatim completa com Pelotas.
  if (!temNaArea(achados) && !abortado(op.signal)) {
    try { achados = achados.concat(await nominatimEnderecos(principal, op)); }
    catch (e) {
      if (e && e.name === "AbortError") { fim([], "cancelada"); throw e; }
      rede = true;
    }
  }
  if (!achados.length && rede) {
    if (!op._retry && !abortado(op.signal)) {
      await new Promise(r => setTimeout(r, 400));
      if (!abortado(op.signal)) {
        const deNovo = Object.assign({}, buscarOuOpts && typeof buscarOuOpts === "object" ? buscarOuOpts : {}, { _retry: true, evento: op.evento });
        return buscarEnderecos(texto, deNovo);
      }
    }
    const ultima = (diag.chamadas || []).slice().reverse().find(c => c && (c.status || c.erro));
    const err = new Error(ultima && ultima.erro ? ultima.erro : "rede");
    err.rede = true;
    err.status = ultima && ultima.status ? ultima.status : 0;
    fim([], err.message);
    throw err;
  }
  const ordenados = filtrarRuidos(ordenarEnderecos(achados, texto, op.bias), texto);
  if (achados.length > ordenados.length) diag.notaRuido = "filtro de texto removeu " + (achados.length - ordenados.length);
  const lista = deduplicarEnderecos(ordenados).slice(0, 6);
  const qRua = semAcento(expandirNomesDeRua(sep.texto));
  lista.forEach(e => {
    const n = semAcento(e.nome);
    const mesmaRua = qRua && (n === qRua || n.indexOf(qRua) === 0);
    if (sep.numero && mesmaRua) e.numero = sep.numero;
    else if (!sep.numero && e.numeroOsm) e.numero = e.numeroOsm;
    if (sep.complemento && mesmaRua) e.complemento = sep.complemento;
    const linhas = linhasEndereco(e);
    e.titulo = linhas.titulo;
    e.subtitulo = linhas.subtitulo;
  });
  return fim(lista);
}

// Retorna { km, linha: [[lat,lng],...] } ou null se o OSRM falhar (o servidor então usa estimativa).
async function calcularRota(a, b) {
  try {
    const url = "https://router.project-osrm.org/route/v1/driving/" + a.lng + "," + a.lat + ";" + b.lng + "," + b.lat +
      "?overview=full&geometries=geojson";
    const r = await fetch(url);
    const j = await r.json();
    if (j.code !== "Ok") return null;
    const rota = j.routes[0];
    return { km: rota.distance / 1000, segundos: rota.duration || 0, linha: rota.geometry.coordinates.map(c => [c[1], c[0]]) };
  } catch { return null; }
}

const ICONE_SUGESTAO = {
  rua: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  poi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.5 5.3 5.8.7-4.3 3.9 1.2 5.7L12 16.2 6.8 18.8l1.2-5.7L3.7 9.2l5.8-.7z"/></svg>',
  recente: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2"/><path d="M12 8.2V12l2.8 1.8"/></svg>'
};

function pintarSugestoes(lista, itens, recente, aoEscolher) {
  lista.innerHTML = "";
  itens.forEach(e => {
    const item = document.createElement("button");
    item.type = "button";
    const icone = recente ? "recente" : (e.tipo === "poi" ? "poi" : "rua");
    item.className = "sugestao sugestao-" + icone;
    item.innerHTML = '<i class="sug-ico">' + ICONE_SUGESTAO[icone] + '</i><span class="sug-txt"><b></b><span></span></span>';
    const linhas = e.titulo ? { titulo: e.titulo, subtitulo: e.subtitulo || "" } : linhasEndereco(e);
    item.querySelector("b").textContent = linhas.titulo || e.nome || "";
    if (e.fora) {
      item.classList.add("fora");
      item.setAttribute("aria-disabled", "true");
      item.querySelector(".sug-txt span").textContent = textoFora();
    } else item.querySelector(".sug-txt span").textContent = linhas.subtitulo || (nomeArea() + " - RS");
    item.onclick = () => {
      if (e.fora) {
        avisoSugestao(lista, textoFora(), null, "");
        if (typeof toast === "function") toast(textoFora());
        return;
      }
      lista.innerHTML = "";
      aoEscolher(Object.assign({}, e, { titulo: linhas.titulo, subtitulo: linhas.subtitulo }));
    };
    lista.append(item);
  });
  if (itens.length) mostrarEstadoBusca(lista, "Escolha um endereço");
}

function mostrarEstadoBusca(lista, texto) {
  if (lista) lista.classList.add("ativa");
  const outra = lista && lista.id === "sugOrigem" ? document.getElementById("sugDestino")
    : lista && lista.id === "sugDestino" ? document.getElementById("sugOrigem") : null;
  if (outra) outra.classList.remove("ativa");
  const tela = document.getElementById("telaPlano");
  if (tela && lista && lista.id === "sugOrigem") tela.dataset.foco = "origem";
  if (tela && lista && lista.id === "sugDestino") tela.dataset.foco = "destino";
  const el = document.getElementById("estadoBusca");
  if (!el || !lista || (lista.id !== "sugOrigem" && lista.id !== "sugDestino")) return;
  el.textContent = texto || "";
}

function avisoSugestao(lista, texto, aoMarcarMapa, consulta) {
  mostrarEstadoBusca(lista, texto);
  lista.innerHTML = "";
  const vazio = document.createElement("div");
  vazio.className = "sugestao-vazia small";
  vazio.textContent = texto;
  lista.append(vazio);
  if (aoMarcarMapa && consulta) {
    const marcar = document.createElement("button");
    marcar.type = "button";
    marcar.className = "sugestao sugestao-mapa";
    marcar.textContent = "Usar este endereço e marcar no mapa";
    marcar.onclick = () => { lista.innerHTML = ""; aoMarcarMapa(consulta); };
    lista.append(marcar);
  }
}

// O Gboard deixa o texto na composição e só grava input.value no fim.
// compositionupdate traz o trecho em ev.data enquanto o value ainda está velho.
function textoComposicaoCampo(valor, ev, compondo, trecho) {
  let v = String(valor || "");
  const data = ev && ev.data != null ? String(ev.data) : "";
  const tipo = ev && ev.type || "";
  if ((tipo === "compositionupdate" || tipo === "compositionend") && data) {
    if (v.indexOf(data) === -1) v = (v + data).replace(/\s+/g, " ");
  } else if (compondo && trecho && v.indexOf(trecho) === -1) {
    v = (v + trecho).replace(/\s+/g, " ");
  }
  return v.trim();
}

// Liga um <input> a uma lista de sugestões. aoEscolher recebe {nome, lat, lng, numero, titulo}.
// aoMarcarMapa(texto) abre o mapa quando a busca não acha nada ou a rede falha.
// opts.bias() é a pessoa (se estiver em Pelotas) ou null. opts.recentes() aparece antes de digitar.
function autocompletar(input, lista, aoEscolher, aoMarcarMapa, opts) {
  opts = opts || {};
  let timer = null, ctrl = null, seq = 0, poll = null;
  let compondo = false, trecho = "";
  const min = opts.minChars || 2;
  function parar() {
    if (ctrl) { try { ctrl.abort(); } catch (e) {} ctrl = null; }
  }
  function bias() {
    try { return opts.bias ? opts.bias() : null; } catch (e) { return null; }
  }
  function mostrarRecentes() {
    const rec = opts.recentes ? opts.recentes() : [];
    if (!rec || !rec.length) { lista.innerHTML = ""; return; }
    pintarSugestoes(lista, rec, true, e => {
      input.value = e.titulo || e.nome || "";
      input.dataset.escolhido = "1";
      aoEscolher(e);
    });
  }
  async function buscarAgora(t, evento) {
    parar();
    const minha = ++seq;
    ctrl = typeof AbortController === "function" ? new AbortController() : { abort() {}, signal: undefined };
    avisoSugestao(lista, "Buscando…", null, "");
    let res = [];
    try {
      res = await buscarEnderecos(t, { signal: ctrl.signal, bias: bias(), evento: evento || "" });
    } catch (e) {
      if (minha !== seq || (e && e.name === "AbortError")) return;
      const codigo = e && e.status ? " (HTTP " + e.status + ")" : "";
      const detalhe = e && e.message && e.message !== "rede" ? " " + e.message : "";
      avisoSugestao(lista, "Erro de rede" + codigo + detalhe + ". Verifique a internet e tente de novo.", aoMarcarMapa, t);
      return;
    }
    if (minha !== seq) return;
    if (!res.length) avisoSugestao(lista, "Nenhum resultado.", aoMarcarMapa, t);
    else pintarSugestoes(lista, res, false, e => {
      input.value = e.titulo || e.nome || "";
      input.dataset.escolhido = "1";
      aoEscolher(e);
    });
  }
  let ultimoAgendado = null;
  let ultimoEvento = "";
  function agendar(ev) {
    const tela = document.getElementById("telaPlano");
    if (tela && (input.id === "origem" || input.id === "destino")) tela.dataset.foco = input.id;
    let evento = ev && ev.type || "input";
    if ((evento === "keyup" || evento === "input" || evento === "poll") && compondo && trecho) {
      const cru = String(input.value || "").trim();
      const cheio = textoComposicaoCampo(input.value, { type: "compositionupdate", data: trecho }, true, trecho);
      if (cheio && cru !== cheio) evento = "compositionupdate";
    }
    const fonte = evento === "compositionupdate" && trecho ? { type: "compositionupdate", data: trecho } : ev;
    const t = textoComposicaoCampo(input.value, fonte, compondo, trecho);
    if (t === ultimoAgendado) {
      if (t.length >= min && !lista.querySelector(".sugestao, .sugestao-vazia")) avisoSugestao(lista, "Buscando…", null, "");
      else if (t.length >= min) lista.classList.add("ativa");
      return;
    }
    ultimoAgendado = t;
    ultimoEvento = evento;
    clearTimeout(timer);
    parar();
    seq++;
    input.dataset.escolhido = "";
    if (t.length < min) {
      if (!t) mostrarRecentes();
      else lista.innerHTML = "";
      if (!lista.querySelector(".sugestao")) lista.classList.remove("ativa");
      const estado = document.getElementById("estadoBusca");
      if (estado && (lista.id === "sugOrigem" || lista.id === "sugDestino")) estado.textContent = "";
      return;
    }
    avisoSugestao(lista, "Buscando…", null, "");
    timer = setTimeout(() => buscarAgora(t, ultimoEvento), opts.debounce == null ? BUSCA_DEBOUNCE_MS : opts.debounce);
  }
  function marcarTocado() {
    document.querySelectorAll("input[data-tocado='1']").forEach(el => { if (el !== input) el.dataset.tocado = ""; });
    input.dataset.tocado = "1";
  }
  input.addEventListener("compositionstart", () => { compondo = true; trecho = ""; marcarTocado(); });
  input.addEventListener("compositionupdate", ev => { compondo = true; trecho = ev && ev.data ? String(ev.data) : trecho; marcarTocado(); agendar(ev); });
  input.addEventListener("compositionend", ev => { compondo = false; trecho = ""; marcarTocado(); agendar(ev); });
  input.addEventListener("input", agendar);
  input.addEventListener("keyup", agendar);
  input.addEventListener("touchstart", marcarTocado, { passive: true });
  input.addEventListener("pointerdown", marcarTocado);
  input.addEventListener("focus", () => {
    marcarTocado();
    if (!input.value.trim() && !trecho) mostrarRecentes();
  });
  // O Gboard às vezes não dispara input/keyup e tira o activeElement.
  // Enquanto a tela está aberta e o campo foi tocado, o valor é lido a cada 400 ms.
  poll = setInterval(() => {
    const tela = document.getElementById("telaPlano");
    const pino = document.getElementById("telaPino");
    const noPlano = tela && !tela.classList.contains("hidden") && tela.contains(input);
    const noPino = pino && !pino.classList.contains("hidden") && pino.contains(input);
    if (!noPlano && !noPino) return;
    if (input.dataset.tocado !== "1" && document.activeElement !== input) return;
    agendar({ type: "poll" });
  }, 400);
  input._ejaRecentes = mostrarRecentes;
}

// Número da casa (OSM de Pelotas quase não tem). "S/N" é válido. Complemento opcional, máx. 80.
function validarDetalhe(numero, sn, complemento) {
  const comp = String(complemento || "").trim();
  if (comp.length > 80) return { ok: false, erro: "Complemento muito longo (máx. 80)." };
  let n = sn ? "S/N" : String(numero || "").trim();
  if (/^(s\/n|sn|s\.n\.?)$/i.test(n)) n = "S/N";
  if (!n) return { ok: false, erro: "Informe o número ou marque S/N." };
  if (n !== "S/N" && !/^[0-9A-Za-z][0-9A-Za-z./-]{0,9}$/.test(n)) {
    return { ok: false, erro: "Número inválido. Use o número da casa ou S/N." };
  }
  return { ok: true, numero: n, complemento: comp || null };
}

// "Rua X · Centro, nº 120 — portão azul" (número e complemento somem se não existirem).
// O que aparece no campo: "Rua Padre Anchieta, 1978". S/N não entra na linha.
function textoCampo(nome, numero) {
  const base = String(nome || "").trim();
  const n = numero && numero !== "S/N" ? String(numero).trim() : "";
  return n ? base + ", " + n : base;
}

function textoEndereco(nome, numero, complemento) {
  const n = !numero ? "" : numero === "S/N" ? "S/N" : "nº " + numero;
  const linha = [nome || "", n].filter(Boolean).join(", ");
  return complemento ? linha + " — " + complemento : linha;
}

// "Rua General Osório, 100 · Centro". Sem número ou sem bairro, a parte some.
function linhaDoPino(rua, numero, bairro) {
  const base = String(rua || "").trim();
  const n = numero && String(numero).trim() && String(numero).trim() !== "S/N" ? String(numero).trim() : "";
  const com = n ? (base ? base + ", " + n : n) : base;
  let b = String(bairro || "").trim();
  if (b && semAcento(b) === "pelotas") b = "";
  if (com && b) return com + " · " + b;
  return com || b || "";
}

function bairroDoPonto(p) {
  if (!p) return "";
  const a = p.address || {};
  const b = p.district || p.suburb || p.neighbourhood || p.city_district || p.quarter || p.locality
    || a.suburb || a.neighbourhood || a.quarter || a.city_district || "";
  const t = String(b || "").trim();
  if (!t || semAcento(t) === "pelotas") return "";
  return t;
}

// Rua, número (se o OSM tiver) e bairro. A coordenada de confirmação continua sendo o pino.
function montarEnderecoPino(p) {
  if (!p) return null;
  const amig = rotuloAmigavel(p);
  const rua = String(p.street || (amig.tipo === "rua" ? amig.nome : "") || amig.nome || "").trim();
  const numero = String(p.housenumber || (p.address && p.address.house_number) || "").trim();
  const bairro = bairroDoPonto(p);
  const nome = String(amig.nome || rua || "").trim();
  if (!nome && !rua) return null;
  const linha = linhaDoPino(rua || nome, numero, bairro);
  return { rua: rua || nome, numero, bairro, nome: nome || rua, linha: linha || nome || rua, tipo: amig.tipo || "poi" };
}

function nominatimParaProps(j) {
  const a = (j && j.address) || {};
  return {
    name: (j && j.name) || a.road || a.pedestrian || "",
    street: a.road || a.pedestrian || a.residential || a.footway || "",
    housenumber: a.house_number || "",
    district: a.suburb || a.neighbourhood || a.quarter || a.city_district || "",
    city: a.city || a.town || "",
    osm_key: (j && (j.class || j.category)) || "",
    osm_value: (j && j.type) || "",
    address: a
  };
}

async function lerJsonBusca(buscar, url, init) {
  const r = await buscar(url, init);
  if (!r || r.ok === false) return null;
  if (typeof r.json === "function") return await r.json();
  return r;
}

// Reverse do pino: Photon e, se não vier rua, Nominatim. Não move o mapa.
// Retorna { rua, numero, bairro, nome, linha } ou null. O fetch do navegador não manda User-Agent.
async function enderecoNoPonto(lat, lng, opts) {
  opts = opts || {};
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const buscar = opts.buscar || (typeof buscarHttp === "function" ? buscarHttp : (typeof fetch === "function" ? fetch : null));
  if (!buscar) return null;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  if (opts.signal && ctrl) opts.signal.addEventListener("abort", () => ctrl.abort());
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, opts.timeout || 4000);
  const init = ctrl ? { signal: ctrl.signal } : {};
  const abortou = e => !!(e && e.name === "AbortError");
  try {
    let end = null;
    try {
      const photon = await lerJsonBusca(buscar, "https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng, init);
      const feat = photon && photon.features && photon.features[0];
      end = feat ? montarEnderecoPino(feat.properties || {}) : null;
    } catch (e) {
      if (abortou(e)) return null;
    }
    if (end && end.rua) return end;
    try {
      const nomi = await lerJsonBusca(buscar, "https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=" + lat + "&lon=" + lng, init);
      const extra = nomi ? montarEnderecoPino(nominatimParaProps(nomi)) : null;
      return extra || end;
    } catch (e) {
      return end;
    }
  } finally { clearTimeout(timer); }
}

// Nome de um ponto (para "Localização atual"). Retorna texto ou null.
// timeout padrão de 4 s. signal cancela a consulta anterior.
async function nomeDoPonto(lat, lng, opts) {
  opts = opts || {};
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, opts.timeout || 4000);
  try {
    if (opts.signal && ctrl) opts.signal.addEventListener("abort", () => ctrl.abort());
    const init = ctrl ? { signal: ctrl.signal } : {};
    const r = await fetch("https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng, init);
    const j = await r.json();
    const f = j && j.features && j.features[0];
    if (!f) return null;
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [lng, lat];
    if (!dentroBusca(c[1], c[0])) return null;
    const amig = rotuloAmigavel(p);
    return amig.nome || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
