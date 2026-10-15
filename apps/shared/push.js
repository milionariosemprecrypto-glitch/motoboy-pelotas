// Notificações push (só no app Android; no navegador não faz nada).
async function iniciarPush(app, aoTocar) {
  const C = window.Capacitor;
  if (!FIREBASE_PRONTO || !C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const Push = C.Plugins.PushNotifications;
  if (!Push) return;
  let perm = await Push.checkPermissions();
  if (perm.receive === "prompt") perm = await Push.requestPermissions();
  if (perm.receive !== "granted") return;
  await Push.createChannel({ id: "eja", name: "É-Já", importance: 5, sound: "default" }).catch(() => {});
  Push.addListener("registration", t => db.rpc("registrar_token", { p_token: t.value, p_app: app }).then(() => {}));
  Push.addListener("pushNotificationActionPerformed", a => aoTocar && aoTocar(a.notification.data || {}));
  Push.addListener("pushNotificationReceived", n => aoTocar && aoTocar(n.data || {}));
  try { await Push.register(); } catch (e) { console.warn("push", e); }
}
