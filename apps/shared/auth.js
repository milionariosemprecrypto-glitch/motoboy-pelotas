// Tela de login/cadastro compartilhada. Cada app chama iniciarAuth({ role, aoEntrar }).
function iniciarAuth({ role, aoEntrar, exigirAceite = true }) {
  let modo = "entrar";
  const docsPapel = role === "motoboy" ? ["termos_motoboy", "privacidade"] : ["termos_cliente", "privacidade"];
  // Checkbox de aceite (clickwrap): não vem marcado e bloqueia o cadastro até ser marcado.
  if (exigirAceite && !$("campoAceite")) {
    $("authBtn").insertAdjacentHTML("beforebegin", `<label id="campoAceite" class="aceite hidden"><input type="checkbox" id="aceiteTermos">
      <span>Li e aceito os <a href="${LINK_DOC[docsPapel[0]]}" target="_blank" rel="noopener">${NOME_DOC[docsPapel[0]]}</a>
      e a <a href="${LINK_DOC.privacidade}" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>`);
    $("aceiteTermos").onchange = () => { if (modo === "cadastrar") $("authBtn").disabled = !$("aceiteTermos").checked; };
  }
  const trocar = m => {
    modo = m;
    $("authTitulo").textContent = m === "entrar" ? "Entrar" : "Criar conta";
    $("authBtn").textContent = m === "entrar" ? "Entrar" : "Cadastrar";
    show("campoNome", m === "cadastrar");
    if ($("campoAceite")) { show("campoAceite", m === "cadastrar"); $("authBtn").disabled = m === "cadastrar" && !$("aceiteTermos").checked; }
    $("authTroca").textContent = m === "entrar" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar";
    $("authMsg").textContent = "";
  };
  $("authTroca").onclick = () => trocar(modo === "entrar" ? "cadastrar" : "entrar");
  $("authForm").onsubmit = async ev => {
    ev.preventDefault();
    const email = $("authEmail").value.trim(), password = $("authSenha").value;
    $("authBtn").disabled = true; $("authMsg").textContent = "";
    try {
      if (modo === "entrar") {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (exigirAceite && !$("aceiteTermos").checked) throw new Error("Marque que leu e aceita os termos para continuar.");
        const { data: vig } = await db.from("documentos_vigentes").select("doc, versao");
        const versoes = Object.fromEntries((vig || []).map(d => [d.doc, d.versao]));
        const { data, error } = await db.auth.signUp({ email, password,
          options: { data: { role, nome: $("authNome").value.trim(), aceite_termos: "true", aceite_versoes: versoes,
                             user_agent: navigator.userAgent.slice(0, 400), app_versao: APP_VERSAO } } });
        if (error) throw error;
        if (!data.session) $("authMsg").textContent = "Enviamos um link de confirmação para o seu e-mail.";
      }
    } catch (e) { $("authMsg").textContent = erroMsg(e); }
    finally { $("authBtn").disabled = modo === "cadastrar" && $("aceiteTermos") && !$("aceiteTermos").checked; }
  };
  $("authLink").onclick = async () => {
    const email = $("authEmail").value.trim();
    if (!email) { $("authMsg").textContent = "Digite seu e-mail primeiro."; return; }
    const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    $("authMsg").textContent = error ? erroMsg(error) : "Link de acesso enviado para " + email + ".";
  };
  $("sair").onclick = () => db.auth.signOut();
  trocar("entrar");

  let atual; // undefined: força mostrar a tela certa na primeira vez
  db.auth.onAuthStateChange((_ev, session) => {
    const uid = session ? session.user.id : null;
    if (uid === atual) return;
    atual = uid;
    show("telaAuth", !session);
    show("telaApp", !!session);
    show("sair", !!session);
    if (session) setTimeout(() => exigirAceite ? conferirAceites(session.user, aoEntrar) : aoEntrar(session.user), 0);
  });
}

// Pede novo aceite quando há versão nova dos documentos (ou se o cadastro foi feito sem aceite).
async function conferirAceites(user, continuar) {
  const { data: pend, error } = await db.rpc("aceites_pendentes");
  if (error || !pend || !pend.length) return continuar(user);
  let m = $("modalAceite");
  if (!m) { document.body.insertAdjacentHTML("beforeend", '<div id="modalAceite" class="modal-aceite"><div class="modal-caixa"></div></div>'); m = $("modalAceite"); }
  const links = pend.map(d => `<li><a href="${d.url}" target="_blank" rel="noopener">${NOME_DOC[d.doc] || d.doc}</a> <small>(versão ${d.versao})</small></li>`).join("");
  m.firstChild.innerHTML = `<h2>Atualizamos nossos termos</h2><p class="small">Para continuar usando o É-Já, leia e aceite:</p><ul>${links}</ul>
    <label class="aceite"><input type="checkbox" id="aceiteNovo"><span>Li e aceito os documentos acima.</span></label>
    <button id="aceiteOk" class="primary btn-preto" disabled>Aceitar e continuar</button><button id="aceiteSair" class="link">Sair</button>
    <div id="aceiteMsg" class="erro"></div>`;
  m.classList.remove("hidden");
  $("aceiteNovo").onchange = () => $("aceiteOk").disabled = !$("aceiteNovo").checked;
  $("aceiteSair").onclick = () => { m.classList.add("hidden"); db.auth.signOut(); };
  $("aceiteOk").onclick = async () => {
    const { error } = await db.rpc("registrar_aceites", { p_docs: pend.map(d => d.doc), p_user_agent: navigator.userAgent.slice(0, 400), p_app_versao: APP_VERSAO });
    if (error) { $("aceiteMsg").textContent = erroMsg(error); return; }
    m.classList.add("hidden"); continuar(user);
  };
}

// "Excluir minha conta" (LGPD art. 18, VI; exigência da Google Play). Pedidos ficam anonimizados para fins fiscais.
async function excluirConta() {
  const txt = prompt("Excluir sua conta apaga seu cadastro, documentos e login. Pedidos antigos ficam anonimizados por obrigação legal/fiscal.\n\nPara confirmar, digite EXCLUIR:");
  if (txt === null) return;
  if (txt.trim().toUpperCase() !== "EXCLUIR") { alert("Confirmação incorreta. Nada foi excluído."); return; }
  const { data: s } = await db.auth.getSession();
  if (!s.session) return;
  const r = await fetch(SUPABASE_URL + "/functions/v1/excluir-conta", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.session.access_token, apikey: SUPABASE_KEY },
    body: JSON.stringify({ confirmacao: "EXCLUIR", origem: "app" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { alert("Não foi possível excluir: " + (j.erro || r.status)); return; }
  alert("Sua conta foi excluída. Obrigado por ter usado o É-Já.");
  await db.auth.signOut();
  try { localStorage.clear(); } catch {}
  location.reload();
}
