// Tela de login/cadastro compartilhada. Cada app chama iniciarAuth({ role, aoEntrar }).
function iniciarAuth({ role, aoEntrar }) {
  let modo = "entrar";
  const trocar = m => {
    modo = m;
    $("authTitulo").textContent = m === "entrar" ? "Entrar" : "Criar conta";
    $("authBtn").textContent = m === "entrar" ? "Entrar" : "Cadastrar";
    show("campoNome", m === "cadastrar");
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
        const { data, error } = await db.auth.signUp({ email, password,
          options: { data: { role, nome: $("authNome").value.trim() } } });
        if (error) throw error;
        if (!data.session) $("authMsg").textContent = "Enviamos um link de confirmação para o seu e-mail.";
      }
    } catch (e) { $("authMsg").textContent = erroMsg(e); }
    finally { $("authBtn").disabled = false; }
  };
  $("authLink").onclick = async () => {
    const email = $("authEmail").value.trim();
    if (!email) { $("authMsg").textContent = "Digite seu e-mail primeiro."; return; }
    const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    $("authMsg").textContent = error ? erroMsg(error) : "Link de acesso enviado para " + email + ".";
  };
  $("sair").onclick = () => db.auth.signOut();
  trocar("entrar");

  let atual = null;
  db.auth.onAuthStateChange((_ev, session) => {
    const uid = session ? session.user.id : null;
    if (uid === atual) return;
    atual = uid;
    show("telaAuth", !session);
    show("telaApp", !!session);
    show("sair", !!session);
    if (session) setTimeout(() => aoEntrar(session.user), 0);
  });
}
