// Notificações push (só no app Android; no navegador não faz nada).
async function iniciarPush(app, aoTocar) {
  const C = window.Capacitor;
  if (!FIREBASE_PRONTO || !C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const Push = C.Plugins.PushNotifications;
  if (!Push) return;
  let perm = await Push.checkPermissions();
  if (perm.receive === "prompt") perm = await Push.requestPermissions();
  if (perm.receive !== "granted") return;
  // Canais Android (o som do canal é fixo depois de criado; por isso ids novos).
  // Os arquivos ficam em android/app/src/main/res/raw/.
  if (app === "motoboy") await Push.createChannel({ id: "eja_corrida", name: "Novas corridas", description: "Toque alto para corridas novas",
    importance: 5, sound: "eja_corrida.wav", vibration: true, visibility: 1, lights: true, lightColor: "#FF6A00" }).catch(() => {});
  await Push.createChannel({ id: "eja_status", name: "Status do pedido", importance: 4, sound: "eja_aceito.wav", vibration: true }).catch(() => {});
  Push.addListener("registration", t => db.rpc("registrar_token", { p_token: t.value, p_app: app }).then(() => {}));
  Push.addListener("pushNotificationActionPerformed", a => aoTocar && aoTocar(a.notification.data || {}));
  Push.addListener("pushNotificationReceived", n => aoTocar && aoTocar(n.data || {}));
  try { await Push.register(); } catch (e) { console.warn("push", e); }
}
