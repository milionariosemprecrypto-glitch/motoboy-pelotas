// Busca de endereços (Photon/OSM, com Nominatim se o Photon vier vazio) e rota de rua (OSRM).
// ATENÇÃO: os servidores públicos gratuitos têm limite de uso e não garantem disponibilidade.
// Nominatim: no máximo 1 consulta por segundo e User-Agent identificando o app (política de uso).
// BBox do município inteiro (oeste, sul, leste, norte): Centro, Fragata, Areal, Três Vendas, Laranjal e a zona rural.
const PELOTAS_BBOX = [-52.63, -31.82, -51.99, -31.30];
const NOMINATIM_INTERVALO_MS = 1100;
let nominatimLivreEm = 0;

function dentroPelotas(lat, lng) {
  const [o, s, l, n] = PELOTAS_BBOX;
  return lng >= o && lng <= l && lat >= s && lat <= n;
}

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

function consultasEndereco(texto) {
  const bruto = String(texto || "").trim().replace(/\s+/g, " ");
  const cheio = expandirAbrev(bruto);
  const sem = semAcento(cheio);
  const lista = [];
  [cheio, sem, bruto].forEach(q => { if (q && lista.indexOf(q) < 0) lista.push(q); });
  return lista;
}

function nomeEndereco(p) {
  const rua = [p.name !== p.street ? p.name : null, p.street && (p.street + (p.housenumber ? ", " + p.housenumber : ""))]
    .filter(Boolean).join(" - ");
  return [rua || p.name, p.district || p.locality].filter(Boolean).join(" · ");
}

function cidadePelotas(p) {
  const c = semAcento((p && (p.city || p.town || p.county || (p.address && (p.address.city || p.address.town)))) || "");
  if (!c) return true;
  return c.indexOf("pelotas") >= 0;
}

function deduplicarEnderecos(lista) {
  const vistos = {};
  return lista.filter(e => {
    const chave = semAcento(e.nome) + "|" + e.lat.toFixed(4) + "|" + e.lng.toFixed(4);
    if (vistos[chave]) return false;
    vistos[chave] = true;
    return true;
  });
}

function ordenarEnderecos(lista, consulta) {
  const q = semAcento(expandirAbrev(consulta));
  const tokens = q.split(" ").filter(t => t.length > 2);
  const centro = (typeof PELOTAS !== "undefined" && PELOTAS) || [-31.765, -52.342];
  return lista.slice().sort((a, b) => pontuar(b) - pontuar(a));
  function pontuar(e) {
    const n = semAcento(e.nome);
    let s = 0;
    if (q && n.indexOf(q) >= 0) s += 80;
    tokens.forEach(t => { if (n.indexOf(t) >= 0) s += 12; });
    const dLat = (e.lat - centro[0]) * 111000, dLng = (e.lng - centro[1]) * 111000 * Math.cos(centro[0] * Math.PI / 180);
    return s - Math.hypot(dLat, dLng) / 800;
  }
}

async function photonEnderecos(q, buscar, comBbox) {
  const centro = (typeof PELOTAS !== "undefined" && PELOTAS) || [-31.765, -52.342];
  let url = "https://photon.komoot.io/api/?limit=8&lang=default&lat=" + centro[0] + "&lon=" + centro[1] +
    "&q=" + encodeURIComponent(q);
  if (comBbox) url += "&bbox=" + PELOTAS_BBOX.join(",");
  const r = await buscar(url);
  if (!r || !r.ok) return [];
  const j = typeof r.json === "function" ? await r.json() : r;
  return ((j && j.features) || []).map(f => {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [];
    return { nome: nomeEndereco(p), lat: c[1], lng: c[0], cidadeOk: cidadePelotas(p) };
  }).filter(e => e.nome && e.lat != null && dentroPelotas(e.lat, e.lng) && e.cidadeOk);
}

async function nominatimEnderecos(q, buscar) {
  const agora = Date.now();
  const espera = nominatimLivreEm - agora;
  if (espera > 0) await new Promise(res => setTimeout(res, espera));
  nominatimLivreEm = Date.now() + NOMINATIM_INTERVALO_MS;
  const [o, s, l, n] = PELOTAS_BBOX;
  const url = "https://nominatim.openstreetmap.org/search?" +
    "format=jsonv2&addressdetails=1&limit=6&countrycodes=br&bounded=0" +
    "&viewbox=" + [o, n, l, s].join(",") +
    "&q=" + encodeURIComponent(q + ", Pelotas, Rio Grande do Sul, Brasil");
  const r = await buscar(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "E-Ja/1.2 (entrega em Pelotas; +https://eja-site.pages.dev)"
    }
  });
  if (!r || !r.ok) return [];
  const j = typeof r.json === "function" ? await r.json() : r;
  return (j || []).map(item => ({
    nome: nomeEndereco({
      name: item.name || (item.address && (item.address.road || item.address.pedestrian)) || "",
      street: item.address && item.address.road,
      district: item.address && (item.address.suburb || item.address.neighbourhood),
      locality: "Pelotas"
    }) || item.display_name,
    lat: Number(item.lat), lng: Number(item.lon), cidadeOk: cidadePelotas(item)
  })).filter(e => e.nome && dentroPelotas(e.lat, e.lng) && e.cidadeOk);
}

// Não cola "Pelotas" na consulta do Photon: "Av Brasil Pelotas" passa a achar o aeroporto
// e some com a Avenida Brasil. O recorte é o bbox + a preferência pelo centro da cidade.
async function buscarEnderecos(texto, buscar) {
  buscar = buscar || (typeof fetch === "function" ? fetch : null);
  if (!buscar) return [];
  const consultas = consultasEndereco(texto);
  if (!consultas.length) return [];
  let achados = [];
  for (const q of consultas) {
    try { achados = await photonEnderecos(q, buscar, true); } catch (e) { achados = []; }
    if (!achados.length) {
      try { achados = await photonEnderecos(q, buscar, false); } catch (e) { achados = []; }
    }
    if (achados.length) break;
  }
  if (!achados.length) {
    try { achados = await nominatimEnderecos(consultas[0], buscar); } catch (e) { achados = []; }
  }
  return ordenarEnderecos(deduplicarEnderecos(achados), texto).slice(0, 6);
}

// Retorna { km, linha: [[lat,lng],...] } ou null se o OSRM falhar (o servidor então usa estimativa).
async function calcularRota(a, b) {
  try {
    const url = "https://router.project-osrm.org/route/v1/driving/" + a.lng + "," + a.lat + ";" + b.lng + "," + b.lat +
      "?overview=simplified&geometries=geojson";
    const r = await fetch(url);
    const j = await r.json();
    if (j.code !== "Ok") return null;
    const rota = j.routes[0];
    return { km: rota.distance / 1000, segundos: rota.duration || 0, linha: rota.geometry.coordinates.map(c => [c[1], c[0]]) };
  } catch { return null; }
}

// Liga um <input> a uma lista de sugestões. aoEscolher({nome, lat, lng}).
// aoMarcarMapa(texto) abre o mapa quando a busca não acha nada.
function autocompletar(input, lista, aoEscolher, aoMarcarMapa) {
  let timer = null, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    input.dataset.escolhido = "";
    const t = input.value.trim();
    if (t.length < 3) { lista.innerHTML = ""; return; }
    timer = setTimeout(async () => {
      const minha = ++seq;
      let res = [];
      try { res = await buscarEnderecos(t); } catch (e) { res = []; }
      if (minha !== seq) return;
      lista.innerHTML = "";
      res.forEach(e => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "sugestao";
        item.textContent = e.nome;
        item.onclick = () => { input.value = e.nome; input.dataset.escolhido = "1"; lista.innerHTML = ""; aoEscolher(e); };
        lista.append(item);
      });
      if (!res.length) {
        const vazio = document.createElement("div");
        vazio.className = "sugestao-vazia small";
        vazio.textContent = "Nenhum endereço encontrado em Pelotas.";
        lista.append(vazio);
        if (aoMarcarMapa) {
          const marcar = document.createElement("button");
          marcar.type = "button";
          marcar.className = "sugestao sugestao-mapa";
          marcar.textContent = "Usar este endereço e marcar no mapa";
          marcar.onclick = () => { lista.innerHTML = ""; aoMarcarMapa(t); };
          lista.append(marcar);
        }
      }
    }, 400);
  });
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
function textoEndereco(nome, numero, complemento) {
  const n = !numero ? "" : numero === "S/N" ? "S/N" : "nº " + numero;
  const linha = [nome || "", n].filter(Boolean).join(", ");
  return complemento ? linha + " — " + complemento : linha;
}

// Nome de um ponto (para "Localização atual" e pino arrastado). Retorna texto ou null.
async function nomeDoPonto(lat, lng) {
  try {
    const r = await fetch("https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng);
    const f = (await r.json()).features[0];
    return f ? nomeEndereco(f.properties) : null;
  } catch { return null; }
}
