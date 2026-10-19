// Busca de endereços (Photon/OSM) limitada a Pelotas-RS e rota de rua (OSRM).
// ATENÇÃO: os servidores públicos gratuitos (photon.komoot.io e router.project-osrm.org) têm limite de uso
// e não garantem disponibilidade. Para produção com muitos usuários, use servidor próprio ou serviço pago.
const PELOTAS_BBOX = [-52.52, -31.86, -52.18, -31.62]; // oeste, sul, leste, norte (zona urbana + Laranjal)

function dentroPelotas(lat, lng) {
  const [o, s, l, n] = PELOTAS_BBOX;
  return lng >= o && lng <= l && lat >= s && lat <= n;
}

function nomeEndereco(p) {
  const rua = [p.name !== p.street ? p.name : null, p.street && (p.street + (p.housenumber ? ", " + p.housenumber : ""))]
    .filter(Boolean).join(" - ");
  return [rua || p.name, p.district || p.locality].filter(Boolean).join(" · ");
}

async function buscarEnderecos(texto) {
  const url = "https://photon.komoot.io/api/?limit=6&bbox=" + PELOTAS_BBOX.join(",") +
    "&lat=" + PELOTAS[0] + "&lon=" + PELOTAS[1] + "&q=" + encodeURIComponent(texto + " Pelotas");
  const r = await fetch(url);
  if (!r.ok) throw new Error("Busca de endereço indisponível");
  const j = await r.json();
  return j.features
    .map(f => ({ nome: nomeEndereco(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }))
    .filter(e => e.nome && dentroPelotas(e.lat, e.lng));
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
    return { km: rota.distance / 1000, linha: rota.geometry.coordinates.map(c => [c[1], c[0]]) };
  } catch { return null; }
}

// Liga um <input> a uma lista de sugestões. aoEscolher({nome, lat, lng}).
function autocompletar(input, lista, aoEscolher) {
  let timer = null, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    input.dataset.escolhido = "";
    const t = input.value.trim();
    if (t.length < 3) { lista.innerHTML = ""; return; }
    timer = setTimeout(async () => {          // espera parar de digitar (respeita limite do Photon)
      const minha = ++seq;
      let res = [];
      try { res = await buscarEnderecos(t); } catch {}
      if (minha !== seq) return;
      lista.innerHTML = "";
      res.forEach(e => {
        const item = document.createElement("div");
        item.className = "sugestao";
        item.textContent = e.nome;
        item.onclick = () => { input.value = e.nome; input.dataset.escolhido = "1"; lista.innerHTML = ""; aoEscolher(e); };
        lista.append(item);
      });
      if (!res.length) lista.innerHTML = '<div class="sugestao-vazia small" style="padding:12px">Nenhum endereço em Pelotas encontrado</div>';
    }, 450);
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
