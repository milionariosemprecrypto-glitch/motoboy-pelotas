# É-Já — entregas por motoboy em Pelotas-RS

Dois apps Android (via **Capacitor**, que empacota HTML/JS como app nativo) usando o mesmo Supabase:

| Pasta | App | Para quem |
|---|---|---|
| `apps/cliente` | **É-Já** | Clientes que pedem entregas |
| `apps/motoboy` | **É-Já Motoboy** | Motoboys cadastrados e aprovados |
| `apps/shared` | — | Config do Supabase, login e estilo (copiado para `www/shared` de cada app) |
| `supabase/` | — | Migrations, backup do estado original e testes de RLS |
| `legacy/index.html` | — | Protótipo antigo (ainda é o que está no Cloudflare) |

## Rodar no computador
```sh
cd apps/cliente && npm install && npm run serve   # http://localhost:8081
cd apps/motoboy && npm install && npm run serve   # http://localhost:8082
```

## Gerar o app Android (Fase 2)
Instale o Android Studio, depois em cada app: `npm run android:add` (só a 1ª vez), `npm run android:sync`, `npm run android:open`.

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
