# Checklist Play Store

1. Conta de desenvolvedor Google Play (US$ 25, uma vez): https://play.google.com/console — conta pessoal nova exige
   **teste fechado com pelo menos 12 testadores por 14 dias seguidos** antes de liberar produção.
2. Criar 2 apps no Console: "É-Já" (br.com.eja.cliente) e "É-Já Motoboy" (br.com.eja.motoboy).
3. Publicar `docs/privacidade.html` e `docs/termos.html` em um link público (ex.: ativar GitHub Pages do repositório na pasta /docs)
   e preencher [NOME], [CNPJ/CPF], [E-MAIL] nos textos. Revisar com advogado.
4. Enviar `eja-*-release.aab` (gerados por `scripts/build-apks.sh`). Ativar "Assinatura de apps do Google Play" (aceita a chave enviada).
5. Ficha da loja: ícone 512×512 (`apps/*/assets/icon-only.png` redimensionado), imagem de destaque 1024×500, 2+ capturas de tela, descrição curta e completa.
6. Questionários: classificação de conteúdo, público-alvo (18+), **Segurança dos dados** (declarar: localização precisa, nome, e-mail, telefone,
   fotos, documentos de identificação; criptografado em trânsito; usuário pode pedir exclusão), anúncios (não), app de governo (não).
7. App Motoboy — **permissão de serviço em primeiro plano tipo "location"**: declarar no Console com vídeo curto mostrando o motoboy online
   e a notificação fixa "Compartilhando sua localização durante o trabalho".
8. Exclusão de conta: a Play exige um link/forma de pedir exclusão de conta e dados (o e-mail da política serve no início; ideal é um botão no app).
9. Para cada nova versão: aumentar `versionCode` e `versionName` em `apps/<app>/android/app/build.gradle`.
