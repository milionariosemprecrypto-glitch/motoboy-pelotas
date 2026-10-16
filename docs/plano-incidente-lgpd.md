# Plano de Resposta a Incidentes de Segurança com Dados Pessoais — É-Já

**Versão 1.0 · 16/10/2026** · Base: LGPD art. 46 a 49 · **Res. CD/ANPD 15/2024** (Regulamento de Comunicação de Incidente) · Res. CD/ANPD 2/2022 (agentes de pequeno porte)

> **Minuta** para revisão por advogado(a). Imprima, preencha os contatos e deixe acessível offline.

## 1. Papéis e contatos

| Papel | Quem | Contato |
|---|---|---|
| Responsável pelo incidente (decide e comunica) | [NOME/RAZÃO SOCIAL] – Julio | [E-MAIL] / telefone |
| Encarregado (DPO) / canal do titular | [E-MAIL] | |
| Apoio técnico | Desenvolvedor responsável | |
| Advogado(a) | [a definir] | |
| Fornecedores | Supabase (support@supabase.com / painel), Google Firebase, Cloudflare, GitHub | |

## 2. O que é um incidente

Qualquer evento, confirmado ou suspeito, que comprometa a **confidencialidade, integridade ou disponibilidade** de dados pessoais. Exemplos: vazamento de chave `service_role` ou de token do GitHub/Supabase; acesso indevido ao painel admin; documentos do bucket `motoboy-docs` expostos; banco apagado ou criptografado; celular de um administrador perdido sem bloqueio; e-mail enviado à pessoa errada com dados.

## 3. Passo a passo (relógio começa quando tomamos conhecimento)

**Hora 0 – Conter (imediato)**
1. Anotar data e hora da descoberta e quem avisou.
2. **Revogar e trocar credenciais** envolvidas: chaves do Supabase (painel › Settings › API › *rotate*), token de acesso da Management API, `GITHUB_TOKEN`, senha das contas admin, conta de serviço do Firebase, segredos `EJA_NOTIFICAR_SECRET` e `EJA_RETENCAO_SECRET`.
3. Suspender a conta ou o acesso suspeito (`profiles.role`, bloqueio de usuário no Auth) e, se preciso, colocar o app em manutenção.
4. **Preservar evidências:** exportar logs do Supabase (API, Auth, Storage), Cloudflare e GitHub; tirar prints; não apagar nada.

**Até 24 h – Avaliar**
5. Quais dados, de quantos titulares, desde quando, se foram de fato acessados e se estavam cifrados.
6. **Há risco ou dano relevante?** (Res. 15/2024, art. 5º). Considere **sim** se envolver: dados sensíveis (selfie/biometria, certidões criminais), documentos (CPF, CNH), dados financeiros, dados de crianças, localização associada a pessoa, credenciais, ou grande número de titulares, com possibilidade de fraude, discriminação, dano moral ou material.
7. Decidir e registrar a decisão com a justificativa (mesmo se for "não comunicar").

**Até 3 dias úteis – Comunicar (se houver risco ou dano relevante)**
8. **ANPD:** formulário de Comunicação de Incidente de Segurança no gov.br (www.gov.br/anpd › Comunicação de Incidente). Informar: descrição, natureza e categoria dos dados, número de titulares, medidas técnicas de segurança, riscos, motivo de eventual demora, medidas tomadas e a tomar, e contato do encarregado. Informações faltantes podem ser complementadas em até 20 dias úteis.
9. **Titulares:** por e-mail e aviso no app, em linguagem simples (modelo abaixo).
10. Agentes de pequeno porte têm prazos em dobro para alguns atos (Res. 2/2022); mesmo assim, **trabalhe com 3 dias úteis**.

**Depois – Corrigir e aprender**
11. Corrigir a causa (código, RLS, configuração), revisar acessos, ativar 2FA onde faltar.
12. Relatório final de 1 página com linha do tempo, causa, impacto e ações.

## 4. Registro de incidentes (obrigatório, guardar por **5 anos**)

Planilha com: nº · data/hora do fato e da ciência · descrição · dados e titulares afetados · avaliação de risco · comunicado à ANPD? (data/protocolo) · comunicado aos titulares? (data) · medidas · responsável. **Registre também os incidentes não comunicados** (Res. 15/2024, art. 10).

## 5. Modelo de comunicado ao titular

> **Assunto: Aviso importante sobre seus dados no É-Já**
>
> Olá, [nome]. Em [data], identificamos [descrição simples do ocorrido]. Os dados envolvidos foram: [lista]. Já tomamos estas medidas: [troca de chaves, bloqueio de acesso etc.]. Recomendamos que você: [trocar senha, ficar atento a mensagens suspeitas, etc.]. Possíveis riscos: [descrever]. Dúvidas: [E-MAIL] (encarregado de dados). Pedimos desculpas pelo transtorno.
>
> [NOME/RAZÃO SOCIAL] · CNPJ [CNPJ]

## 6. Prevenção (revisar a cada 6 meses)

- 2FA nas contas Supabase, GitHub, Google/Firebase, Cloudflare e no e-mail do admin.
- Nunca colocar a chave `service_role` no app ou no repositório; o app usa só a chave pública + RLS.
- Bucket `motoboy-docs` privado; links assinados de 120 s; rotinas de descarte (`eja_limpar_gps`, `eja_retencao_docs`) ativas.
- Testes de RLS (`supabase/tests/*.sql`) a cada mudança de banco.
- Backups do banco (plano Supabase) e teste de restauração.
- Lista de quem tem acesso admin, revista mensalmente.
