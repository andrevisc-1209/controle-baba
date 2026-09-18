# Controle de pagamento — Babá

App estático (HTML/CSS/JS puro, sem build) para controlar o pagamento
semanal e as parcelas/extras de uma funcionária doméstica. Hospedado no
GitHub Pages, com Airtable como banco de dados, acessado direto do
navegador pela API REST do Airtable (sem backend intermediário).

## Como funciona

- **`index.html`** — interface (mesma do protótipo original feito em
  Claude Artifact).
- **`app.js`** — toda a lógica: cálculo de saldo, sugestão de valor
  semanal, geração dos pagamentos de sexta, propagação de parcelas.
  Fala direto com `https://api.airtable.com/v0/...`.
- **Base do Airtable** `appnOnkT3glbNHmmZ` ("Controle Baba"), duas
  tabelas:
  - `Meses` — um registro por mês (`MesID` no formato `AAAA-MM`,
    `ValorMensal`). `TotalPago` (rollup) e `Saldo` (fórmula) são
    calculados pelo próprio Airtable.
  - `Lancamentos` — um registro por pagamento, linkado a `Meses`.
    Parcelas são campos estruturados (`ParcelaAtual`, `ParcelaTotal`,
    `GrupoParcela`), não texto embutido.

## Configurar o token do Airtable

O token fica embutido em `index.html` (linha com `AIRTABLE_TOKEN`) e é
carregado direto pelo navegador — decisão consciente do projeto, não é
um esquecimento. A mitigação é o **escopo do token**: ele só pode
ler/escrever nesta base específica, nada mais.

Para criar o token:

1. Acesse [airtable.com/create/tokens](https://airtable.com/create/tokens).
2. **Name**: algo como `controle-baba-frontend`.
3. **Scopes**: marque só `data.records:read` e `data.records:write`.
4. **Access**: "Add a base" → selecione a base **Controle Baba**
   (`appnOnkT3glbNHmmZ`) e nenhuma outra.
5. Crie o token e copie o valor (começa com `pat...`).
6. Abra `index.html`, ache a linha:
   ```js
   var AIRTABLE_TOKEN = "COLE_SEU_TOKEN_AQUI";
   ```
   e cole o token no lugar do placeholder.
7. Commit e push — o GitHub Pages republica em ~1 minuto.

### Se precisar revogar/recriar o token

1. Em [airtable.com/create/tokens](https://airtable.com/create/tokens),
   abra o token antigo e clique em **Delete**.
2. Crie um novo seguindo os passos acima (mesmo escopo, mesma base).
3. Atualize a linha `AIRTABLE_TOKEN` em `index.html`, commit e push.
4. O app para de funcionar imediatamente após a revogação do token
   antigo e volta a funcionar assim que o novo token for publicado.

## Testar localmente antes de publicar

```bash
python3 -m http.server 8000
```

Abra `http://localhost:8000` — funciona igual ao GitHub Pages (é
estático, sem servidor próprio).

## Migrar os dados históricos

Os dados antigos (do artifact do Claude) têm algumas inconsistências
que precisam ser revisadas **antes** de importar — veja
`INCONSISTENCIAS.md` (gerado localmente, não versionado neste
repositório porque tem valores/datas reais de pagamento).

Depois de decidir o que fazer com cada inconsistência, rode:

```bash
pip install requests
export AIRTABLE_TOKEN="pat...."   # mesmo token/escopo do index.html
python3 migrate_to_airtable.py caminho/para/export.json
```

O script é idempotente (usa o campo `OrigemImportID` para não duplicar
em reexecuções) e não sobrescreve registros já existentes.

## Deploy

Publicado via GitHub Pages a partir da branch `main`, raiz do
repositório. Qualquer push em `main` atualiza o site em produção.
