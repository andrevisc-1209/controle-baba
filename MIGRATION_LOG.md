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

## 4. Migração dos dados — AINDA NÃO EXECUTADA

Conforme pedido, a migração real não foi rodada. Relatório de inconsistências
gerado em `INCONSISTENCIAS.md` (local, não versionado) com 5 categorias
verificadas no export de 27 meses / 133 lançamentos:

1. 3 lançamentos com `date`/`month` divergentes (mesmo bug corrigido no item 2)
2. 6 lançamentos "Semanal" que não caem numa sexta real (antecipações/atrasos)
3. 1 duplicidade de numeração de parcela (Óculos, parcela 5/12 aparece duas
   vezes — `hist_13` e `hist_6`) — **essa é a que você já sabia**
4. 2 meses em que o total pago superou o valor mensal combinado
5. 1 caso de drift de arredondamento de R$0,02

Depois de revisar e decidir o que fazer com cada um (corrigir no JSON antes
de importar, ou importar como está e ajustar depois direto no Airtable),
rode `migrate_to_airtable.py` — instruções no README.md.
