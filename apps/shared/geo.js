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

// Nome de um ponto (para "Localização atual" e pino arrastado). Retorna texto ou null.
async function nomeDoPonto(lat, lng) {
  try {
    const r = await fetch("https://photon.komoot.io/reverse?lat=" + lat + "&lon=" + lng);
    const f = (await r.json()).features[0];
    return f ? nomeEndereco(f.properties) : null;
  } catch { return null; }
}
