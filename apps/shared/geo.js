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
// O centro da pessoa entra mesmo fora de Pelotas, para achar a rua vizinha.
// A consulta da cidade é feita em paralelo, senão "Av Brasil" em Turuçu some.
function centroBusca(bias) {
  const c = lerCentro(bias);
  if (c && dentroBusca(c[0], c[1])) return c;
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

function deFeature(p, lng, lat) {
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
  if (!dentroBusca(lat, lng)) return null;
  const amig = rotuloAmigavel(p);
  if (!amig.nome) return null;
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
    buscar: o.buscar || (typeof fetch === "function" ? fetch : null),
    signal: o.signal || null,
    bias: o.bias || null,
    _retry: !!o._retry
  };
}

function abortado(signal) {
  return !!(signal && signal.aborted);
}

async function photonEnderecos(q, op, comBbox) {
  const centro = centroBusca(op.bias);
  let url = "https://photon.komoot.io/api/?limit=8&lang=default&lat=" + centro[0] + "&lon=" + centro[1] +
    "&q=" + encodeURIComponent(q);
  if (comBbox) url += "&bbox=" + bboxBusca().join(",");
  const init = {};
  if (op.signal) init.signal = op.signal;
  const r = await op.buscar(url, init);
  if (!r || !r.ok) {
    const err = new Error("photon");
    err.rede = true;
    err.status = r && r.status;
    throw err;
  }
  const j = typeof r.json === "function" ? await r.json() : r;
  return ((j && j.features) || []).map(f => {
    const c = (f.geometry && f.geometry.coordinates) || [];
    return deFeature(f.properties || {}, c[0], c[1]);
  }).filter(Boolean);
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
  const init = { headers: { "Accept": "application/json" } };
  if (op.signal) init.signal = op.signal;
  const r = await op.buscar(url, init);
  if (!r || !r.ok) {
    const err = new Error("nominatim");
    err.rede = true;
    err.status = r && r.status;
    throw err;
  }
  const j = typeof r.json === "function" ? await r.json() : r;
  return (j || []).map(item => deFeature({
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
  }, Number(item.lon), Number(item.lat))).filter(Boolean);
}

// Não cola "Pelotas" na consulta do Photon: "Av Brasil Pelotas" passa a achar o aeroporto
// e some com a Avenida Brasil. O recorte é o bbox + a preferência por quem está pedindo.
async function buscarEnderecos(texto, buscarOuOpts) {
  const op = opcoesBusca(buscarOuOpts);
  if (!op.buscar) return [];
  const sep = separarNumero(texto);
  const consultas = consultasEndereco(texto);
  if (!consultas.length) return [];
  if (abortado(op.signal)) return [];
  const principal = consultas[0];
  const paralelas = [principal];
  consultas.forEach(q => {
    if (q === principal || semAcento(q) === semAcento(principal)) return;
    if (paralelas.length < 3) paralelas.push(q);
  });
  let rede = false;
  let achados = [];
  const centroPessoa = centroBusca(op.bias);
  const centroCidade = centroPelotas();
  const centros = [centroPessoa];
  if (Math.abs(centroPessoa[0] - centroCidade[0]) > 0.02 || Math.abs(centroPessoa[1] - centroCidade[1]) > 0.02) centros.push(centroCidade);
  const tarefas = [];
  paralelas.forEach(q => centros.forEach(c => tarefas.push({ q: q, bias: c })));
  const lotes = await Promise.all(tarefas.map(async t => {
    try { return await photonEnderecos(t.q, Object.assign({}, op, { bias: t.bias }), true); }
    catch (e) {
      if (e && e.name === "AbortError") throw e;
      rede = true;
      return [];
    }
  }));
  achados = lotes.reduce((acc, lista) => acc.concat(lista), []);
  if (!achados.length && !abortado(op.signal)) {
    try { achados = await photonEnderecos(principal, op, false); }
    catch (e) {
      if (e && e.name === "AbortError") throw e;
      rede = true;
    }
  }
  if (!achados.length && !abortado(op.signal)) {
    const dobra = consultas.filter(q => q !== principal && semAcento(q) === semAcento(principal));
    for (const q of dobra) {
      try {
        achados = await photonEnderecos(q, op, true);
        if (achados.length) break;
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        rede = true;
      }
    }
  }
  if (!achados.length && !abortado(op.signal)) {
    try { achados = await nominatimEnderecos(principal, op); }
    catch (e) {
      if (e && e.name === "AbortError") throw e;
      rede = true;
    }
  }
  if (!achados.length && rede) {
    if (!op._retry && !abortado(op.signal)) {
      await new Promise(r => setTimeout(r, 400));
      if (!abortado(op.signal)) return buscarEnderecos(texto, Object.assign({}, buscarOuOpts && typeof buscarOuOpts === "object" ? buscarOuOpts : {}, { _retry: true }));
    }
    const err = new Error("rede");
    err.rede = true;
    throw err;
  }
  const ordenados = filtrarRuidos(ordenarEnderecos(achados, texto, op.bias), texto);
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
  return lista;
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
}

function avisoSugestao(lista, texto, aoMarcarMapa, consulta) {
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

// Liga um <input> a uma lista de sugestões. aoEscolher recebe {nome, lat, lng, numero, titulo}.
// aoMarcarMapa(texto) abre o mapa quando a busca não acha nada ou a rede falha.
// opts.bias() é a pessoa ou o centro do mapa; opts.recentes() aparece antes de digitar.
function autocompletar(input, lista, aoEscolher, aoMarcarMapa, opts) {
  opts = opts || {};
  let timer = null, ctrl = null, seq = 0;
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
  async function buscarAgora(t) {
    parar();
    const minha = ++seq;
    ctrl = typeof AbortController === "function" ? new AbortController() : { abort() {}, signal: undefined };
    avisoSugestao(lista, "Buscando…", null, "");
    let res = [];
    try {
      res = await buscarEnderecos(t, { signal: ctrl.signal, bias: bias() });
    } catch (e) {
      if (minha !== seq || (e && e.name === "AbortError")) return;
      const codigo = e && e.status ? " (erro " + e.status + ")" : "";
      avisoSugestao(lista, "Não foi possível buscar" + codigo + ". Verifique a internet e tente de novo.", aoMarcarMapa, t);
      return;
    }
    if (minha !== seq) return;
    if (!res.length) avisoSugestao(lista, "Nenhum endereço encontrado.", aoMarcarMapa, t);
    else pintarSugestoes(lista, res, false, e => {
      input.value = e.titulo || e.nome || "";
      input.dataset.escolhido = "1";
      aoEscolher(e);
    });
  }
  let ultimoAgendado = null;
  function agendar() {
    const tela = document.getElementById("telaPlano");
    if (tela && (input.id === "origem" || input.id === "destino")) tela.dataset.foco = input.id;
    const t = input.value.trim();
    if (t === ultimoAgendado) return;
    ultimoAgendado = t;
    clearTimeout(timer);
    parar();
    seq++;
    input.dataset.escolhido = "";
    if (t.length < min) {
      if (!t) mostrarRecentes();
      else lista.innerHTML = "";
      return;
    }
    avisoSugestao(lista, "Buscando…", null, "");
    timer = setTimeout(() => buscarAgora(t), opts.debounce == null ? BUSCA_DEBOUNCE_MS : opts.debounce);
  }
  input.addEventListener("input", agendar);
  input.addEventListener("keyup", agendar);
  input.addEventListener("compositionend", agendar);
  input.addEventListener("focus", () => {
    if (!input.value.trim()) mostrarRecentes();
  });
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

// Nome de um ponto (para "Localização atual" e pino arrastado). Retorna texto ou null.
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
