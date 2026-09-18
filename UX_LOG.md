# Log de mudanças de UX

Histórico de mudanças na interface (`index.html`/`app.js`). Separado do
`MIGRATION_LOG.md`, que documenta schema e dados no Airtable.

## Rodada 1 — revisão de UX aplicada (2026-09-18)

Itens revisados e aprovados numa sessão anterior, implementados e testados
nesta rodada. Todos testados no navegador (servidor estático local,
`python3 -m http.server`) antes de publicar.

### 1. Checkbox "Pago": área de toque maior + atualização otimista

- O checkbox passou a ficar dentro de um `<label class="pago-toggle-wrap">`
  de 44×44px — resolve acessibilidade (o rótulo associa o clique ao campo)
  e aumenta a área de toque, que antes era de só 18×18px.
- O clique não recarrega mais a lista inteira (`loadMeses` +
  `refreshMonthView`, duas chamadas de rede + redesenho de toda a lista).
  Agora atualiza direto na tela: o valor do lançamento entra/sai do
  `TotalPago`/`Saldo` em memória (`monthsCache`), e só a linha tocada e os
  3 números do topo mudam. Se o `PATCH` falhar, desfaz visualmente e mostra
  o banner de erro.
- Testado: clique marca/desmarca instantaneamente, sem o antigo flash de
  "Carregando…"; testado também o caminho de falha revertendo o estado.

### 2. Botão "excluir": área de toque maior e separação visual

- Padding de `4px 8px` para `8px 12px`, com um pequeno espaço (`margin-bottom`
  no texto do pagador) antes do botão, pra não ficar colado no valor/pagador.

### 3. Categoria padrão do formulário + lembrar a última usada

- "Extra / compra" passou a ser a primeira opção (antes era "Semanal", que
  hoje é resolvido pelo botão "Gerar sextas", não pelo formulário manual).
- A categoria escolhida é lembrada via `localStorage`
  (`controle-baba:lastCategoria`), per-viewer, sem precisar de nenhuma
  infraestrutura nova. Testado: escolhido "Adiantamento", recarregada a
  página, o formulário abriu com "Adiantamento" pré-selecionado.

### 4. Progresso na propagação de parcelas

- `propagateInstallments` ganhou um callback `onProgress(i, total)`,
  chamado antes de cada criação. O botão de salvar passa a mostrar
  "Criando parcela 3/11…" em vez de um "Salvando…" estático durante toda
  a criação em lote. Testado com uma parcela 1/6 (5 propagações): o botão
  mostrou "Criando parcela 1/5…", "2/5…", "3/5…" em sequência.

### 5. Banner de erro/offline fixo no topo da viewport

- `position:fixed; top:0; left:0; right:0` em vez de estático no fluxo da
  página. Testado: banner simulado com a lista rolada pra baixo — ficou
  visível no topo da tela o tempo todo.

### 6. Visão geral: destaque de meses com saldo negativo

- Linhas com saldo negativo ganham um fundo avermelhado sutil
  (`color-mix(in srgb, var(--neg) 12%, transparent)`), além da cor do
  número. Testado com os meses negativos reais já existentes na base
  (jun/2026, abr/2026, mar/2026, nov/2025) — o destaque apareceu neles
  automaticamente, sem precisar simular nada.

### 7. Edição inline de valor/data (preserva `Pago`)

- Tocar no valor ou na data de um lançamento abre um campo de edição
  na própria linha (`<span class="editable">` trocado por um `<input>`).
  Salva ao perder o foco (blur), Enter confirma, Esc cancela.
- Editar o **valor** só grava o campo `Valor` — `Pago` nunca é tocado.
  Testado: mudado um valor, o lançamento continuou com o mesmo estado de
  `Pago` (marcado ou pendente) de antes.
- Editar a **data** grava `Data` e, se a nova data cair num mês diferente
  do atual, também recalcula e troca o link `Mes` (reaproveitando
  `ensureMonthRecord`, a mesma lógica já usada no formulário de novo
  lançamento) e avisa com um alerta ("Lançamento movido pra Mês/Ano").
  Testado com um lançamento de teste: mudei a data de maio pra junho de
  2027, o lançamento desapareceu da lista de maio, apareceu em junho, e o
  alerta de "movido" apareceu corretamente — `Pago` preservado.

### 8. "Valor mensal": vira um ícone de lápis discreto

- O input + botão "salvar", antes sempre visíveis abaixo dos 3 stats,
  agora ficam escondidos por padrão. Um ícone de lápis (✎) ao lado do
  rótulo "Valor do mês" abre a edição só quando clicado, e ela se esconde
  de novo depois de salvar. Testado: clique abre o campo, clique de novo
  fecha sem salvar.

### Verificação final

Depois de todos os testes (que criaram e apagaram vários lançamentos de
teste em meses vazios), confirmei que a base voltou exatamente ao estado
anterior: **132 registros**, soma de `Valor` = **R$42.461,52** — idêntico
ao estado antes desta rodada.

Nenhuma mudança de schema do Airtable nesta rodada — só `index.html` e
`app.js`.
