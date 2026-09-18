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

## 5. Mudança de paradigma: de "registro do pago" para "checklist do a pagar" (2026-09-18)

Decisão: os lançamentos deixam de representar só o que já foi pago e passam
a poder existir como **previstos** (sextas do mês, parcelas futuras) até
serem marcados como pagos de fato.

### Schema (Airtable)

- Novo campo **`Pago`** (checkbox) em `Lancamentos` (`fldvhbCWJ3jzRADaY`).
  Default é `false` — no Airtable, um checkbox desmarcado simplesmente não
  grava o campo (fica ausente no retorno da API), então qualquer lançamento
  novo já nasce "não pago" sem precisar de nenhuma lógica extra.
- Novo campo **`ValorPago`** (fórmula) em `Lancamentos`: `IF({Pago}, {Valor}, 0)`.
  Existe só pra alimentar o rollup abaixo — o rollup do Airtable soma valores
  de UM campo dos registros linkados, não tem como ele mesmo filtrar por um
  segundo campo (`Pago`), daí precisar desse campo intermediário.
- O rollup antigo `TotalPago` em `Meses` (que somava `Valor` de tudo) foi
  **renomeado para `TotalLancado`** e mantido (representa o total previsto,
  pago ou não — pode ser útil).
- Um rollup **novo** com o nome `TotalPago` foi criado em `Meses`, apontando
  pra `ValorPago` em vez de `Valor` — assim só soma o que está marcado como
  pago. `Saldo` foi reapontado pra usar esse novo `TotalPago`.
- Testado com registros de teste (criados e removidos): `Pago=false` →
  `TotalPago=0`; `Pago=true` → soma corretamente.

### Migração dos 133 lançamentos existentes

Dry-run mostrou uma ambiguidade **diferente** da dos óculos: a regra literal
que eu tinha combinado ("mês atual — set/2026 — em diante vira Pago=false")
marcaria como não-pagos 6 lançamentos de setembro/2026 que **já tinham
acontecido de verdade** (dia 18/09 é hoje). Perguntei e você decidiu usar a
**data exata**, não o mês, como corte:

> `Pago = true` se `Data <= 2026-09-18` (hoje), senão `Pago = false`.

Resultado aplicado: **125 lançamentos → Pago=true**, **8 → Pago=false**
(a sexta de 25/09/2026 + as 7 parcelas futuras dos óculos, out/2026 a
abr/2027). Setembro/2026 passou a mostrar Pago R$2.180 / Saldo R$320
(só a sexta de 25/09 pendente); outubro/2026 mostra Pago R$0 / Saldo
R$2.500 (a parcela do mês ainda não paga) — confirmado visualmente no app.

### Front-end (`index.html` / `app.js`)

- Cada lançamento na lista ganhou um checkbox clicável (`.pago-toggle`) que
  faz `PATCH` direto no Airtable ao mudar, sem formulário separado — testado
  no navegador (marca, saldo recalcula na hora; desmarca, volta).
- Lançamento não pago: linha com opacidade reduzida (`.entry.pending`) +
  selo "Pendente" ao lado da categoria.
- Geração de pagamentos de sexta e propagação de parcelas continuam com a
  mesma lógica de antes (cálculo de sugestão semanal inalterado, conforme
  pedido), só passaram a gravar `Pago=false` explicitamente nos lançamentos
  futuros que criam (funcionalmente já seria `false` por omissão, mas deixei
  explícito no código pra ficar claro que é intencional).
- `TotalPago`/`Saldo` no card de estatísticas continuam vindo direto do
  Airtable (nenhuma mudança de código necessária ali — o filtro por `Pago`
  já acontece no rollup, na origem).

## 6. Parcela nasce paga; semanal continua discricionário (2026-09-18)

Decisão: dívida de parcela é comprometida no momento da compra (ao contrário
do pagamento semanal, que é decidido semana a semana). A partir de agora,
qualquer lançamento com `GrupoParcela` preenchido nasce com **`Pago=true`**
— tanto os gerados pela propagação automática quanto os criados manualmente
informando `ParcelaAtual`/`ParcelaTotal` no formulário. Lançamentos
semanais continuam nascendo `Pago=false`, sem alteração.

### Ambiguidade encontrada e resolvida

Pedido original descrevia "renumerar a série do Óculos a partir do
duplicado, sem apagar nada" mas dava como meta explícita "1..12 (12
registros)" — matematicamente incompatível (a série tinha 13 registros:
`1,2,3,4,5,5,6,7,8,9,10,11,12`; renumerar sem apagar dá 13 números, não
12). Perguntei; você optou por **apagar** o registro duplicado
(`hist_6`, "5/12" de set/2026) em vez de estender a série pra 13x. Como
`auto_oculos_06` a `12` já estavam com os números certos (6 a 12), a
exclusão sozinha já deixou a série correta (1..12, 12 registros) sem
precisar renumerar mais nada.

### Dry-run e aplicação

Levantados os 4 grupos de parcela existentes: Óculos (13→12), Geladeira
(12), Remédio (3), Ar condicionado (5) — 33 registros no total, dos quais
27 já estavam `Pago=true` (pela regra de corte por data da seção 5).
Mostrei a tabela antes/depois e esperei confirmação antes de aplicar.

Aplicado:
- **6 registros** Óculos (parcelas 7/12 a 12/12, nov/2026–abr/2027)
  mudaram de `Pago=false` para `true`.
- **1 registro apagado**: `hist_6` (Óculos "5/12" duplicado, set/2026,
  R$120, estava `Pago=true`).
- Nenhum outro campo (`Valor`, `Data`, `GrupoParcela`, `ParcelaAtual` dos
  demais) foi alterado.

Nota: durante a checagem, `auto_oculos_06` (out/2026) já estava marcado
como `Pago=true` — não foi esta sessão que fez isso; presumivelmente uso
real do app entre as duas conversas. Mantido como está.

### Totais confirmados depois de aplicar

| Mês | Pago antes | Pago depois | Saldo antes | Saldo depois |
|---|---|---|---|---|
| Set/2026 | R$2.180 | R$2.060 | R$320 | R$440 |
| Nov/2026 | R$0 | R$120 | R$2.500 | R$2.380 |
| Dez/2026 | R$0 | R$120 | R$2.500 | R$2.380 |
| Jan/2027 | R$0 | R$120 | R$2.500 | R$2.380 |
| Fev/2027 | R$0 | R$120 | R$2.500 | R$2.380 |
| Mar/2027 | R$0 | R$120 | R$2.500 | R$2.380 |
| Abr/2027 | R$0 | R$120 | R$2.500 | R$2.380 |

Todos batendo exatamente com o previsto no dry-run. Soma de `Valor` de
todos os lançamentos da base: R$42.461,52 — exatamente R$42.581,52 (soma
antes desta sessão) menos R$120 do `hist_6` apagado. Total de registros:
**132** (133 − 1).

### Testado no navegador

Criei um lançamento de parcela de teste (1/2) pelo formulário real: nasceu
com o checkbox já marcado. A parcela propagada (2/2) também nasceu marcada.
Ambos os testes foram excluídos depois — base voltou a 132 registros, sem
sobra de teste.

## 7. Correção da gafe na renumeração da série Óculos (2026-09-18)

Ao apagar a duplicata da seção 6, o registro de setembro/2026 foi apagado
por completo em vez de renumerado — a série ficou com um buraco (ago/2026
= parcela 5, out/2026 = parcela 6, sem nada em setembro) e a última parcela
sobrando em abr/2027 em vez de fechar em mar/2027.

### Achado extra antes de corrigir

Entre esta sessão e a anterior, foi criado manualmente pelo app real um
lançamento solto pra tentar preencher o buraco: `rec9PDId7aOFyKHtl`
("Extra/compra", "oculos", R$120, data 18/09/2026, `Pago=true`), **sem**
`ParcelaAtual`/`ParcelaTotal`/`GrupoParcela` — ou seja, sem vínculo
estruturado com a série. Se a correção fosse aplicada por cima dele,
setembro contaria R$240 em óculos (dobrado). Perguntei; decisão foi apagar
esse lançamento solto e substituir pelo registro estruturado correto.

### Correção aplicada

- **Apagado**: `rec9PDId7aOFyKHtl` (o lançamento solto acima).
- **Criado**: registro de setembro/2026 — Extra/compra, Óculos, R$120,
  `ParcelaAtual=6`, `ParcelaTotal=12`, mesmo `GrupoParcela`, data
  01/09/2026, `Pago=true`.
- **Renumerados** (+1 em `ParcelaAtual`, nenhum outro campo tocado):
  out/2026 (6→7), nov/2026 (7→8), dez/2026 (8→9), jan/2027 (9→10),
  fev/2027 (10→11), mar/2027 (11→12).
- **Apagado**: o registro de abr/2027 (`ParcelaAtual=12` antigo, R$120) —
  a série passa a fechar em mar/2027, um lançamento por mês, sem buraco.

Sequência final confirmada via API: 12 registros, `ParcelaAtual` 1..12,
um por mês, abr/2026 a mar/2027 — sem duplicata e sem buraco.

### Totais confirmados depois de aplicar

| Mês | Pago antes | Pago depois | Saldo antes | Saldo depois |
|---|---|---|---|---|
| Set/2026 | R$2.180 | R$2.180 (sem mudança — troca o lançamento solto pelo estruturado) | R$320 | R$320 |
| Out/2026–Mar/2027 | sem mudança (só renumera) | sem mudança | sem mudança | sem mudança |
| Abr/2027 | R$120 | R$0 | R$2.380 | R$2.500 |

Soma de `Valor` de todos os lançamentos: R$42.581,52 → **R$42.461,52**
(−R$120, o valor da parcela que deixou de existir em abr/2027 já que a
série voltou a ter 12 parcelas em 12 meses consecutivos). Total de
registros: 133 → **132**. Confirmado visualmente no app (set/2026
inalterado, abr/2027 zerado e sem lançamentos).

## 8. Saldo acumulado entre meses (2026-09-18)

Pedido: refletir o saldo devedor/credor de um mês no mês seguinte (ex:
dezembro fechou pagando R$1.001,50 a mais, isso deveria aparecer no saldo
de janeiro, não desaparecer).

### Decisão técnica: sem campo novo no Airtable

O pedido original imaginava um campo `SaldoAnterior` (link/lookup pro mês
anterior) mais um `SaldoAcumulado` (`SaldoAnterior + Saldo do mês`). Isso
**não é possível nativamente no Airtable**: um saldo acumulado é uma soma
corrida sobre uma cadeia de meses que cresce com o tempo, e o Airtable não
tem fórmula recursiva nem "rollup do rollup" em cadeia — cada fórmula só
enxerga o registro ligado diretamente, não a cadeia inteira. Um lookup
pegaria o `Saldo` do mês anterior (só esse mês, não o acumulado dele), e
não haveria como compor isso automaticamente sem recriar campos a cada
mês novo criado.

Resolvido calculando o acumulado **no app** (`app.js`), a partir dos 27
meses já carregados em `monthsCache` — mesmo resultado visível pro
usuário, sem fragilidade de manter uma cadeia de links. **Nenhum campo
novo na base.**

### Decisão de produto: informativo, não afeta a sugestão semanal

Perguntado e confirmado: o saldo acumulado é só informativo. A fórmula de
"Semana sugerida" continua exatamente como era (`ValorMensal - dívidas do
mês`, dividido pelas sextas pendentes) — não desconta automaticamente
excedente/déficit de meses anteriores. Decisão do usuário, não decidida
sozinho.

### Dry-run e aplicação

Rodei o cálculo (soma corrida de `Saldo` em ordem cronológica) contra os
27 meses reais e mostrei a tabela mês a mês antes de aplicar. Confirmado.

Durante a checagem, encontrei **5 registros de mês órfãos** (2027-08 a
2027-12) sem nenhum lançamento ligado — sobra de um teste de uma sessão
anterior (propagação de parcela de teste, que criou os meses via
`ensureMonthRecord` mas cujos lançamentos de teste eu já tinha apagado,
sem apagar os meses vazios que sobraram). Confirmei que os 5 tinham 0
lançamentos ligados e apaguei — a base voltou aos 27 meses corretos
(2025-05 a 2027-07). Isso também corrigiu o resumo anual de 2027 (item
3 do `UX_LOG.md`), que estava somando 12 meses em vez de 7 até eu notar.

Aplicado em `app.js`/`index.html`: nova linha "Saldo acumulado até este
mês" na aba Mês, e uma linha "Acumulado" por mês na Visão geral. Testado
no navegador: os valores batem exatos com a tabela do dry-run (ex:
Set/2026 = -R$721,52, Dez/2026 = R$6.418,48).
