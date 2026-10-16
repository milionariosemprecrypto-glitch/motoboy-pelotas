# É-Já — entregas por motoboy em Pelotas-RS

Dois apps Android (via **Capacitor**, que empacota HTML/JS como app nativo) usando o mesmo Supabase:

| Pasta | App | Para quem |
|---|---|---|
| `apps/cliente` | **É-Já** | Clientes que pedem entregas |
| `apps/motoboy` | **É-Já Motoboy** | Motoboys cadastrados e aprovados |
| `apps/shared` | — | Config do Supabase, login e estilo (copiado para `www/shared` de cada app) |
| `supabase/` | — | Migrations, backup do estado original e testes de RLS |
| `apps/admin` | **Painel admin** (web) | Aprovar/bloquear motoboys, ver pedidos — só role admin |
| `supabase/functions/notificar` | — | Edge Function de push (FCM) |
| `docs/` | — | Política de Privacidade e Termos (LGPD) — rascunhos |
| `tests/e2e.py` | — | Teste ponta a ponta (Playwright) contra o Supabase real |
| `legacy/index.html` | — | Protótipo antigo (ainda é o que está no Cloudflare) |

## Rodar no computador
```sh
cd apps/cliente && npm install && npm run serve   # http://localhost:8081
cd apps/motoboy && npm install && npm run serve   # http://localhost:8082
```

Painel admin: `cd apps && python3 -m http.server 8090` e abra http://localhost:8090/admin/

## Gerar os apps Android
Requer JDK 21 e Android SDK (ou Android Studio). `./scripts/build-apks.sh` gera os APKs de debug e, se existir
`apps/<app>/android/keystore.properties`, os AAB de release assinados (para a Play Store) em `/workspace/eja-apks/`.
Formato do `keystore.properties` (NUNCA commitar; guarde o .jks e a senha em local seguro — sem eles não dá para atualizar o app na loja):
```
storeFile=/caminho/eja-release.jks
storePasswordFile=/caminho/senha.txt
keyAlias=eja
```

## Endereços e rotas
Busca: Photon (photon.komoot.io), limitado ao retângulo de Pelotas. Rota: OSRM público (router.project-osrm.org).
São gratuitos e sem chave, **mas com limite de uso e sem garantia** — ok para testes e início; com volume, use servidor próprio
(Photon/OSRM em Docker) ou serviço pago (Google/Mapbox). O app envia a distância da rota, mas o **servidor decide o preço**:
aceita a rota só se estiver entre 1,0× e 2,5× a linha reta; senão usa linha reta × 1,3.

## Notificações push (Firebase) — ver `docs/FIREBASE.md`

## Banco (Supabase)
- `supabase/migrations/20261015000000_baseline.sql` — como o banco estava antes.
- `supabase/migrations/20261015000100_eja_v1.sql` — schema seguro do É-Já (já aplicado).
- `supabase/tests/rls_test.sql` — cole no SQL Editor: cria usuários de teste, testa tudo e desfaz (rollback).

Preço: calculado **no servidor** = `max(tarifa_minima, km × preco_km)`, onde km = linha reta (haversine) × `fator_rota`. Para mudar valores: `update config set valor = 2.5 where chave = 'preco_km';`

### Aprovar um motoboy (SQL Editor do Supabase)
```sql
-- ver cadastros pendentes
select m.id, p.nome, p.telefone, m.cpf, m.cnh, m.placa, m.modelo, m.foto_path, m.doc_path, m.enviado_em
from motoboys m join profiles p on p.id = m.id where m.status = 'pendente' and m.enviado_em is not null;
-- fotos/documentos: Storage > motoboy-docs > pasta com o id do motoboy
update motoboys set status = 'aprovado'  where id = 'COLE-O-ID-AQUI';
update motoboys set status = 'bloqueado' where id = 'COLE-O-ID-AQUI';
-- tornar alguém admin (pode usar definir_status_motoboy pelo app no futuro)
update profiles set role = 'admin' where id = 'SEU-ID';
```
