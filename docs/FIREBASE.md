# Ativar notificações push (Firebase) — passo a passo para o Julio

O código já está pronto: os apps registram o aparelho, o banco chama a Edge Function `notificar` quando um pedido é
criado (avisa motoboys aprovados, online, a até 5 km da retirada) ou muda de status (avisa o cliente).
Hoje a função responde "FCM_SERVICE_ACCOUNT não configurado" — falta só o Firebase.

1. Entre em https://console.firebase.google.com com sua conta Google → **Adicionar projeto** → nome `eja` (Analytics opcional).
2. No projeto, **Adicionar app → Android**:
   - Nome do pacote `br.com.eja.cliente` → baixe o `google-services.json` → coloque em `apps/cliente/android/app/`.
   - Repita com `br.com.eja.motoboy` → `apps/motoboy/android/app/google-services.json`.
3. **Configurações do projeto → Contas de serviço → Gerar nova chave privada** → baixa um arquivo `.json`.
   Esse arquivo é SECRETO (não commitar, não mandar por WhatsApp).
4. No Supabase: **Edge Functions → Secrets → Add new secret**: nome `FCM_SERVICE_ACCOUNT`, valor = conteúdo inteiro do `.json` do passo 3.
5. Em `apps/shared/config.js` mude `FIREBASE_PRONTO = false` para `true`.
6. Gere os apps de novo: `./scripts/build-apks.sh`.

Dica: o `google-services.json` não é secreto, pode ir para o git. O `.json` da conta de serviço é.
