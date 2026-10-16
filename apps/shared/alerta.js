// Sons e vibração do É-Já (sons originais gerados por scripts/make_sounds.py).
const Alerta = {
  chamada: null, timerVib: null, timerFim: null,
  // Navegadores só tocam som depois de um toque do usuário: "destrava" o áudio no primeiro toque.
  destravar() {
    const f = () => {
      ["eja_corrida", "eja_aceito"].forEach(n => { const a = new Audio("shared/sons/" + n + ".wav"); a.muted = true; a.play().then(() => a.pause()).catch(() => {}); });
      document.removeEventListener("pointerdown", f);
    };
    document.addEventListener("pointerdown", f);
  },
  // Toque de corrida em loop + vibração até parar() ou 30 s.
  tocarChamada() {
    this.parar();
    this.chamada = new Audio("shared/sons/eja_corrida.wav");
    this.chamada.loop = true; this.chamada.volume = 1;
    this.chamada.play().catch(() => {});
    const vib = () => navigator.vibrate && navigator.vibrate([600, 250, 600, 250, 600]);
    vib(); this.timerVib = setInterval(vib, 2400);
    this.timerFim = setTimeout(() => this.parar(), 30000);
  },
  parar() {
    if (this.chamada) { this.chamada.pause(); this.chamada = null; }
    clearInterval(this.timerVib); clearTimeout(this.timerFim);
    navigator.vibrate && navigator.vibrate(0);
  },
  tocarAceito() {
    new Audio("shared/sons/eja_aceito.wav").play().catch(() => {});
    navigator.vibrate && navigator.vibrate([150, 80, 150]);
  }
};
Alerta.destravar();
