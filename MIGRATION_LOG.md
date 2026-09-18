# Log de migração — Claude Artifact → Airtable + GitHub Pages

Data: 2026-09-18

## 1. Base do Airtable

Criada no workspace **Andrevisc** (`wsp13vt4YPVkEhlZK`).

- Base: **Controle Baba** — `appnOnkT3glbNHmmZ`
- Tabela **Meses** — `tblT8lZYNH7HcTO6u`
  - `MesID` (texto, chave natural `AAAA-MM`)
  - `ValorMensal` (moeda)
  - `Lancamentos` (link reverso, criado automaticamente pelo link em Lancamentos.Mes)
  - `TotalPago` (rollup, `SUM(Lancamentos.Valor)`)
  - `Saldo` (fórmula, `ValorMensal - TotalPago`)
- Tabela **Lancamentos** — `tblQB5h4Vr0ydn2aX`
  - `Data` (data, formato ISO)
  - `Mes` (link → Meses)
  - `Valor` (moeda)
  - `Categoria` (seleção: Semanal / Extra / compra / Adiantamento / Emprestimo)
  - `QuemPagou` (seleção: André / Andressa)
  - `Motivo` (texto longo)
  - `ParcelaAtual` / `ParcelaTotal` (número)
  - `GrupoParcela` (texto — liga as parcelas da mesma compra)
  - `OrigemImportID` (texto — chave de idempotência; usada tanto pela migração
    quanto pelo próprio app, na geração de pagamentos semanais e na
    propagação de parcelas, pra evitar duplicata em clique duplo)

Testado com um par de registros de teste (criados e removidos nesta sessão):
`TotalPago`/`Saldo` calculam corretamente via rollup/fórmula do Airtable.

Campo `OrigemImportID` não está marcado como oculto em nenhuma view — isso
não é configurável pela API pública do Airtable, precisa ser feito manualmente
na UI (grid view → ocultar campo) se quiser escondê-lo.

## 2. Front-end (`index.html` + `app.js`)

Reescrito para falar direto com `https://api.airtable.com/v0/...` usando os
IDs de tabela/campo acima (não nomes — mais resistente a renomeações
futuras na UI do Airtable). Mudanças de comportamento em relação à versão
anterior (Claude Artifact):

- **Bug de arredondamento corrigido**: a sugestão semanal agora distribui o
  valor em centavos inteiros, sem sobra — a diferença de arredondamento
  (quando o valor não divide exato pelas semanas pendentes) vai para as
  últimas semanas, 1 centavo por vez.
- **Bug de "sexta paga" corrigido**: um lançamento categoria Semanal conta
  como pagamento daquela semana se cair em qualquer dia da mesma semana
  (segunda a domingo) da sexta-feira, não só na data exata da sexta.
- **Parcelas estruturadas**: `ParcelaAtual`/`ParcelaTotal`/`GrupoParcela` são
  campos próprios, não texto embutido no motivo. A propagação futura confere
  `OrigemImportID` antes de criar cada parcela — reexecutar não duplica.
- **Mês do lançamento vem da data digitada**, não da aba aberta na tela —
  corrige o bug encontrado nos dados históricos (`hist_70`/`71`/`72`, ver
  `INCONSISTENCIAS.md`) onde um lançamento de novembro acabava contabilizado
  em dezembro só por estar com a aba de dezembro aberta no momento de salvar.
- **`valorMes` agora usa update parcial** (PATCH do Airtable), não substitui
  o registro inteiro — elimina o risco de um `set()` completo apagar outros
  campos do mês no futuro.
- **Sem tempo real** (Airtable REST não tem equivalente a `onSnapshot`): o
  app faz polling leve (a cada 45s) da tela ativa, além de recarregar depois
  de cada ação própria. Se os dois usuários editarem ao mesmo tempo, pode
  levar até 45s pra um ver a mudança do outro.

## 3. Deploy

- Repositório: **https://github.com/andrevisc-1209/controle-baba** (público —
  necessário pro GitHub Pages gratuito funcionar sem custo)
- GitHub Pages: branch `main`, raiz do repositório
- URL final: **https://andrevisc-1209.github.io/controle-baba/**
- Verificado: build do Pages concluído, página carrega sem erros de console,
  mostra corretamente o aviso de "token não configurado" (esperado — token
  ainda não foi colado, ver README.md).
- Token do Airtable: **não gerado nesta sessão** — a criação de Personal
  Access Token do Airtable exige ação manual na UI do Airtable (não existe
  API pra isso). Passo a passo em `README.md`.

Não commitados no repositório (ficam só na sua máquina): `INCONSISTENCIAS.md`
e o export JSON original — ambos têm valores e datas reais de pagamento, o
que é uma exposição diferente da do token (esse já discutido e aceito) e não
foi combinado explicitamente, por isso ficaram de fora do repositório público
por padrão. Se quiser publicá-los mesmo assim, é só remover as duas linhas
correspondentes do `.gitignore`.

## 4. Migração dos dados — CONCLUÍDA (2026-09-18)

Relatório de inconsistências gerado em `INCONSISTENCIAS.md` (local, não
versionado) com 5 categorias, das quais 2 exigiam decisão sua:

1. **3 lançamentos com `date`/`month` divergentes** (`hist_70`/`71`/`72`) —
   você decidiu corrigir para o mês da data. Migrados para **2025-11**
   (antes constavam em 2025-12). Confirmado via rollup: 2025-11 passou a
   somar R$3.943,75 (saldo -R$1.443,75) e 2025-12 caiu para R$1.056,25
   (saldo +R$1.443,75) — a diferença exata dos 3 lançamentos movidos.
2. **Duplicidade de parcela dos óculos** (`hist_13` ago/26 e `hist_6` set/26,
   ambos "5/12") — você identificou como erro de numeração, mas pediu para
   corrigir manualmente no Airtable depois. **Migrados como estão**, sem
   alteração: a série "Óculos" hoje tem 13 registros pra um total de 12
   parcelas (`GrupoParcela = andre-oculos-12`), com dois "5/12". Pendente de
   você decidir a renumeração direto na base (afeta se o total sobe para 13,
   ou se as parcelas 6-12 sobem um número cada).
3. 6 lançamentos "Semanal" que não caem numa sexta real (antecipações/
   atrasos) — migrados como estão, sem impacto (o app novo já lida com isso
   pelo casamento por semana).
4. 2 meses em que o total pago superou o valor mensal combinado — migrados
   como estão, informativo.
5. 1 caso de drift de arredondamento de R$0,02 — migrado como está,
   informativo.

Executada via chamadas diretas à API do Airtable (mesmo mecanismo usado para
criar o schema), não pelo `migrate_to_airtable.py` — não havia ainda um PAT
do Airtable disponível para o script rodar com o token do usuário. Resultado
final na base: **27 registros em Meses, 133 em Lancamentos** (contagem
confirmada via `list_records_for_table`). `migrate_to_airtable.py` continua
disponível no repo com `--dry-run`/`--fix-month-from-date` para reexecuções
futuras (é idempotente por `OrigemImportID`, então rodá-lo agora não duplica
nada do que já foi criado).
