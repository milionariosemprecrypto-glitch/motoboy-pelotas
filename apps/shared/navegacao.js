// Navegação no app do motoboy (OSRM público). O servidor gratuito tem limite: no máximo 1 consulta
// a cada OSRM_MIN_MS, com piso de OSRM_PISO_MS mesmo quando o destino muda. Fora da rota só
// recalcula depois de duas leituras seguidas, para um GPS ruim não disparar rajada.
var Nav = {
  OSRM_MIN_MS: 15000,
  OSRM_PISO_MS: 4000,
  OSRM_PERIODICO_MS: 60000,
  FORA_ROTA_M: 60,
  rota: null,
  foraSeguidos: 0,
  ultimoFetch: 0,
  ultimoRumo: null,
  ultimaVoz: "",
  falhou: false
};

function NavLimpar() {
  Nav.rota = null;
  Nav.foraSeguidos = 0;
  Nav.falhou = false;
  Nav.ultimaVoz = "";
}

function metrosEntre(a, b) {
  const r = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function rumoGraus(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function paraXY(lat, lng, lat0) {
  const r = Math.PI / 180;
  return { x: lng * r * Math.cos(lat0 * r) * 6371000, y: lat * r * 6371000 };
}

// Ponto mais próximo numa linha [[lat,lng],...]. distM = afastamento; alongM = metros desde o início.
function projetarNaLinha(lat, lng, linha) {
  if (!linha || !linha.length) return null;
  const p = paraXY(lat, lng, lat);
  if (linha.length === 1) {
    const a = paraXY(linha[0][0], linha[0][1], lat);
    return { distM: Math.hypot(p.x - a.x, p.y - a.y), alongM: 0, indice: 0, totalM: 0 };
  }
  let melhor = { distM: Infinity, alongM: 0, indice: 0 }, percorrido = 0;
  for (let i = 0; i < linha.length - 1; i++) {
    const a = paraXY(linha[i][0], linha[i][1], lat);
    const b = paraXY(linha[i + 1][0], linha[i + 1][1], lat);
    const abx = b.x - a.x, aby = b.y - a.y, ab2 = abx * abx + aby * aby;
    let t = ab2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
    const seg = Math.hypot(abx, aby);
    if (dist < melhor.distM) melhor = { distM: dist, alongM: percorrido + seg * t, indice: i };
    percorrido += seg;
  }
  melhor.totalM = percorrido;
  return melhor;
}

function deveConsultarOsrm(o) {
  if (o.destinoMudou || !o.ultima) return true;
  if (o.agora - o.ultima < Nav.OSRM_MIN_MS) return false;
  if ((o.foraSeguidos || 0) >= 2 && o.distForaM > Nav.FORA_ROTA_M) return true;
  if (o.agora - o.ultima >= Nav.OSRM_PERIODICO_MS) return true;
  return false;
}

function precisaRotaNav(lat, lng, alvoKey, agora) {
  agora = agora || Date.now();
  if (!Nav.rota || Nav.rota.alvoKey !== alvoKey) return { buscar: true, forcar: true, fora: false };
  const proj = projetarNaLinha(lat, lng, Nav.rota.linha);
  const fora = !!(proj && proj.distM > Nav.FORA_ROTA_M);
  Nav.foraSeguidos = fora ? Nav.foraSeguidos + 1 : 0;
  return {
    buscar: deveConsultarOsrm({
      agora, ultima: Nav.rota.consultadoEm, distForaM: proj ? proj.distM : 0,
      foraSeguidos: Nav.foraSeguidos, destinoMudou: false
    }),
    forcar: false, fora, proj
  };
}

const DIR_PT = {
  left: "à esquerda", right: "à direita",
  "slight left": "levemente à esquerda", "slight right": "levemente à direita",
  "sharp left": "bem à esquerda", "sharp right": "bem à direita",
  straight: "em frente", uturn: "em retorno"
};
const SETA = {
  left: "↰", right: "↱", "slight left": "↖", "slight right": "↗",
  "sharp left": "⬅", "sharp right": "➡", straight: "↑", uturn: "↩"
};

function instrucaoOsrm(step) {
  const m = (step && step.maneuver) || {};
  const tipo = m.type || "turn";
  const dir = DIR_PT[m.modifier] || "";
  const nome = step && step.name ? step.name : "";
  let base;
  // "continue" + modifier uturn virava "Continue em retorno". O retorno tem frase própria.
  if (tipo === "arrive") base = "Você chegou ao destino";
  else if (m.modifier === "uturn" || tipo === "uturn") base = "Faça o retorno";
  else if (tipo === "depart") base = "Siga " + (dir || "em frente");
  else if (tipo === "roundabout" || tipo === "rotary" || tipo === "roundabout turn" || tipo === "exit roundabout") {
    base = m.exit ? "Na rotatória, pegue a " + m.exit + "ª saída" : "Entre na rotatória";
  } else if (tipo === "fork") base = "Na bifurcação, pegue " + (dir || "em frente");
  else if (tipo === "end of road") base = "No fim da rua, vire " + (dir || "em frente");
  else if (tipo === "merge") base = "Entre na via" + (dir ? " " + dir : "");
  else if (tipo === "on ramp") base = "Pegue a rampa" + (dir ? " " + dir : "");
  else if (tipo === "off ramp") base = "Saia na rampa" + (dir ? " " + dir : "");
  else if (tipo === "continue" || tipo === "new name") base = "Continue " + (dir && dir !== "em frente" ? dir : "em frente");
  else if (!m.modifier || m.modifier === "straight") base = "Siga em frente";
  else base = "Vire " + dir;
  if (nome && tipo !== "arrive" && !(m.modifier === "uturn" || tipo === "uturn")) base += " na " + nome;
  else if (nome && (m.modifier === "uturn" || tipo === "uturn")) base += " na " + nome;
  return base;
}

function setaOsrm(maneuver) {
  const m = maneuver || {};
  if (m.type === "arrive") return "📍";
  return SETA[m.modifier] || "↑";
}

function interpretarOsrm(j) {
  if (!j || j.code !== "Ok" || !j.routes || !j.routes[0]) return null;
  const rota = j.routes[0];
  const linha = (rota.geometry && rota.geometry.coordinates || []).map(c => [c[1], c[0]]);
  if (linha.length < 2) return null;
  const passos = [];
  let along = 0;
  for (const leg of rota.legs || []) {
    for (const step of leg.steps || []) {
      const loc = step.maneuver && step.maneuver.location;
      if (!loc) continue;
      passos.push({
        lat: loc[1], lng: loc[0], alongM: along,
        distancia: step.distance || 0, nome: step.name || "",
        instrucao: instrucaoOsrm(step), seta: setaOsrm(step.maneuver),
        tipo: (step.maneuver && step.maneuver.type) || "turn"
      });
      along += step.distance || 0;
    }
  }
  if (!passos.length) return null;
  // alongM pelo desenho da rota, não pela soma das distâncias do passo: as duas medidas
  // divergem e o banner ficava preso na primeira manobra.
  passos.forEach(p => {
    const proj = projetarNaLinha(p.lat, p.lng, linha);
    if (proj) p.alongM = proj.alongM;
  });
  passos.sort((a, b) => a.alongM - b.alongM);
  return { linha, passos, metros: rota.distance || along, segundos: rota.duration || 0 };
}

function definirRotaNav(rota, alvoKey, agora) {
  if (!rota) return;
  Nav.foraSeguidos = 0;
  Nav.falhou = false;
  Nav.rota = Object.assign({}, rota, { alvoKey: alvoKey, consultadoEm: agora || Date.now() });
}

// Busca a rota com passos. Devolve { throttled, rota }. `buscar` substitui fetch nos testes.
async function buscarRotaNav(origem, destino, opts) {
  opts = opts || {};
  const agora = opts.agora || Date.now();
  const piso = opts.forcar ? Nav.OSRM_PISO_MS : Nav.OSRM_MIN_MS;
  if (Nav.ultimoFetch && agora - Nav.ultimoFetch < piso) return { throttled: true, rota: null };
  Nav.ultimoFetch = agora;
  const buscar = opts.buscar || (typeof fetch === "function" ? fetch : null);
  if (!buscar) return { throttled: false, rota: null };
  try {
    const url = "https://router.project-osrm.org/route/v1/driving/" +
      origem.lng + "," + origem.lat + ";" + destino.lng + "," + destino.lat +
      "?overview=full&geometries=geojson&steps=true&alternatives=false";
    const r = await buscar(url);
    if (!r || !r.ok) return { throttled: false, rota: null };
    const j = typeof r.json === "function" ? await r.json() : r;
    return { throttled: false, rota: interpretarOsrm(j) };
  } catch (e) {
    return { throttled: false, rota: null };
  }
}

function formatarDistancia(m) {
  if (m == null || !isFinite(m)) return "—";
  if (m < 1000) return Math.max(0, Math.round(m / 10) * 10) + " m";
  return (m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " km";
}

function formatarDuracao(s) {
  if (s == null || !isFinite(s)) return "—";
  const min = Math.round(s / 60);
  if (min <= 0) return "1 min";
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60), resto = min % 60;
  return resto ? h + " h " + resto + " min" : h + " h";
}

function textoVoz(instrucao, metros, tipo) {
  if (!instrucao) return "";
  if (tipo === "arrive" || metros < 30) return instrucao;
  const d = metros >= 1000
    ? (metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " quilômetros"
    : Math.max(10, Math.round(metros / 10) * 10) + " metros";
  return "Em " + d + ", " + instrucao.charAt(0).toLowerCase() + instrucao.slice(1);
}

// "Em 200 m vire à esquerda na Rua A" — atualizado a cada leitura de GPS.
function textoManobra(instrucao, metros, tipo) {
  if (!instrucao) return "";
  if (tipo === "arrive" || metros < 25) return instrucao;
  return "Em " + formatarDistancia(metros) + " " + instrucao.charAt(0).toLowerCase() + instrucao.slice(1);
}

// Próxima manobra e o que falta até o destino, a partir da rota já baixada (sem rede).
function painelNav(lat, lng) {
  if (!Nav.rota) return null;
  const proj = projetarNaLinha(lat, lng, Nav.rota.linha);
  if (!proj) return null;
  const passos = Nav.rota.passos;
  let atual = passos[passos.length - 1];
  for (let i = 0; i < passos.length; i++) {
    if (passos[i].tipo === "depart") continue;
    if (passos[i].alongM >= proj.alongM + 12) { atual = passos[i]; break; }
  }
  const metrosManobra = Math.max(0, atual.alongM - proj.alongM);
  const restanteM = Math.max(0, (proj.totalM || Nav.rota.metros) - proj.alongM);
  const base = Nav.rota.metros > 1 ? Nav.rota.segundos * (restanteM / Nav.rota.metros) : 0;
  let instrucao = atual.instrucao, seta = atual.seta, nome = atual.nome, tipo = atual.tipo;
  if (tipo === "arrive" && metrosManobra > 40) {
    instrucao = "Siga em frente"; seta = "↑"; tipo = "continue";
    const anterior = passos.filter(p => p.alongM <= atual.alongM && p.nome).pop();
    nome = (anterior && anterior.nome) || nome;
  }
  return {
    instrucao, seta, nome, tipo, metrosManobra, restanteM, restanteS: base,
    fora: proj.distM > Nav.FORA_ROTA_M,
    voz: textoVoz(instrucao, metrosManobra, tipo)
  };
}

function urlMapaExterno(app, lat, lng) {
  if (lat == null || lng == null) return null;
  if (app === "waze") return "https://waze.com/ul?ll=" + lat + "," + lng + "&navigate=yes";
  return "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + lat + "," + lng;
}
