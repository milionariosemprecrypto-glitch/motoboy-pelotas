// Chat de uma corrida. O banco só deixa ler e enviar enquanto o pedido está aceito ou coletado,
// e só para o cliente e o motoboy daquela corrida (RLS). Aqui é a tela.
function contarNaoLidas(lista, meuId) {
  return (lista || []).filter(m => m && m.autor_id !== meuId && !m.lida_em).length;
}

var Chat = {
  pedidoId: null,
  meuId: null,
  outro: "Motoboy",
  canal: null,
  aberto: false,
  vistos: {},
  timer: null,
  ligar: function (opts) {
    if (!opts || !$("btnChat")) return;
    const ativo = opts.status === "aceito" || opts.status === "coletado";
    this.outro = opts.outro || this.outro;
    this.meuId = opts.meuId || this.meuId;
    show("btnChat", ativo);
    if (!ativo) { this._fechar(); this._desligar(); return; }
    if (this.pedidoId === opts.pedidoId && this.canal) return;
    this._desligar();
    this.pedidoId = opts.pedidoId;
    this.vistos = {};
    this._montar();
    this._carregar();
    this._ouvir();
    const eu = this;
    this.timer = setInterval(function () { if (!eu.aberto) eu._badge(); }, 12000);
  },
  parar: function () { show("btnChat", false); this._fechar(); this._desligar(); },
  alternar: function () {
    if (!this.pedidoId) return;
    this._montar();
    if (this.aberto) this._fechar();
    else { this.aberto = true; show("ejaChat", true); this._carregar(); }
  },
  _montar: function () {
    if ($("ejaChat")) return;
    document.body.insertAdjacentHTML("beforeend",
      '<section id="ejaChat" class="eja-chat hidden" aria-live="polite">' +
      '<div class="eja-chat-topo"><button type="button" id="ejaChatFechar" aria-label="Fechar">←</button><b>Conversa</b><span></span></div>' +
      '<div id="ejaChatLista" class="eja-chat-lista"></div>' +
      '<form id="ejaChatForm"><input id="ejaChatTexto" maxlength="500" placeholder="Escreva uma mensagem" autocomplete="off">' +
      '<button type="submit">Enviar</button></form></section>');
    const eu = this;
    $("ejaChatFechar").onclick = function () { eu._fechar(); };
    $("ejaChatForm").onsubmit = function (ev) { ev.preventDefault(); eu._enviar(); };
  },
  _fechar: function () { this.aberto = false; if ($("ejaChat")) show("ejaChat", false); },
  _desligar: function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.canal) { const c = this.canal; this.canal = null; db.removeChannel(c); }
    this.pedidoId = null;
    this.vistos = {};
    if ($("ejaChatLista")) $("ejaChatLista").textContent = "";
  },
  _ouvir: function () {
    const eu = this, id = this.pedidoId;
    this.canal = db.channel("chat-" + id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens", filter: "pedido_id=eq." + id },
        function (payload) {
          const m = payload.new;
          if (!m) return;
          eu._pintar(m);
          if (m.autor_id !== eu.meuId && !eu.aberto) {
            eu._badge();
            if (typeof toast === "function") toast("Nova mensagem de " + eu.outro);
          } else if (eu.aberto) eu._marcarLidas();
        })
      .subscribe();
  },
  async _carregar() {
    if (!this.pedidoId) return;
    const { data, error } = await db.from("mensagens").select("id,autor_id,texto,criado_em,lida_em")
      .eq("pedido_id", this.pedidoId).order("criado_em", { ascending: true });
    if (error) return;
    if ($("ejaChatLista")) $("ejaChatLista").textContent = "";
    this.vistos = {};
    (data || []).forEach(m => this._pintar(m));
    this._aplicarBadge(contarNaoLidas(data, this.meuId));
    if (this.aberto) this._marcarLidas();
  },
  async _badge() {
    if (!this.pedidoId || this.aberto) return;
    const { count } = await db.from("mensagens").select("id", { count: "exact", head: true })
      .eq("pedido_id", this.pedidoId).neq("autor_id", this.meuId).is("lida_em", null);
    this._aplicarBadge(count || 0);
  },
  _aplicarBadge: function (n) {
    const b = $("chatBadge"); if (!b) return;
    b.textContent = n > 9 ? "9+" : String(n);
    show("chatBadge", n > 0);
  },
  _pintar: function (m) {
    if (!m || !m.id || this.vistos[m.id] || !$("ejaChatLista")) return;
    this.vistos[m.id] = true;
    const eu = m.autor_id === this.meuId;
    const el = document.createElement("div");
    el.className = "msg-bolha " + (eu ? "eu" : "outro");
    const t = document.createElement("span");
    t.textContent = m.texto;
    const s = document.createElement("small");
    const quando = m.criado_em ? new Date(m.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    s.textContent = (eu ? "Você" : this.outro) + (quando ? " · " + quando : "");
    el.append(t, s);
    $("ejaChatLista").append(el);
    $("ejaChatLista").scrollTop = $("ejaChatLista").scrollHeight;
  },
  async _enviar() {
    const campo = $("ejaChatTexto");
    const texto = (campo.value || "").trim();
    if (!texto || !this.pedidoId) return;
    campo.value = "";
    const { data, error } = await db.from("mensagens").insert({ pedido_id: this.pedidoId, autor_id: this.meuId, texto }).select().single();
    if (error) {
      campo.value = texto;
      const msg = (typeof erroMsg === "function" ? erroMsg(error) : error.message);
      if (typeof toast === "function") toast(msg, 4000); else alert(msg);
      return;
    }
    this._pintar(data);
  },
  async _marcarLidas() {
    if (!this.pedidoId) return;
    await db.from("mensagens").update({ lida_em: new Date().toISOString() })
      .eq("pedido_id", this.pedidoId).neq("autor_id", this.meuId).is("lida_em", null);
    this._aplicarBadge(0);
  }
};
