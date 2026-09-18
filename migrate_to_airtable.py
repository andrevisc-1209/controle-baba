#!/usr/bin/env python3
"""
Migra o export do app "Controle de pagamento — Baba" (Firestore-like, via
window.claude db) para um base do Airtable com duas tabelas: Meses e
Lancamentos.

Idempotente: usa o campo OrigemImportID (preenchido com o _id original de
cada lancamento) para nao duplicar registros em reexecucoes.

NAO ALTERA nenhum registro ja existente na base (so cria os que faltam) e
NAO corrige as inconsistencias listadas em INCONSISTENCIAS.md — elas sao
importadas exatamente como estao no export, para voce decidir depois o que
fazer com cada uma direto no Airtable.

Uso:
    export AIRTABLE_TOKEN="patXXXXXXXXXXXXXX"      # PAT com escopo restrito à base
    python3 migrate_to_airtable.py controle-baba-export.json --dry-run   # so mostra o plano
    python3 migrate_to_airtable.py controle-baba-export.json            # cria de fato

Flags:
    --dry-run              Nao cria nada, so imprime o que seria criado.
    --fix-month-from-date   Usa o mes derivado de `date` em vez do campo
                            `month` gravado no export, para os 3 lancamentos
                            com date/month divergentes (ver INCONSISTENCIAS.md
                            item 1). Sem essa flag, mantem o `month` original.

Requisitos: pip install requests
"""

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from typing import Optional

import requests

# Base "Controle Baba" criada via MCP do Airtable nesta sessao.
DEFAULT_BASE_ID = "appnOnkT3glbNHmmZ"
MESES_TABLE = os.environ.get("AIRTABLE_MESES_TABLE", "Meses")
LANCAMENTOS_TABLE = os.environ.get("AIRTABLE_LANCAMENTOS_TABLE", "Lancamentos")

CATEGORIA_LABELS = {
    "semanal": "Semanal",
    "extra": "Extra / compra",
    "adiantamento": "Adiantamento",
    "emprestimo": "Emprestimo",
}

PARCELA_RE = re.compile(r"\s*[-—]?\s*Parc\s*(\d+)\s*/\s*(\d+)\s*$", re.IGNORECASE)


def die(msg: str) -> None:
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


class Airtable:
    def __init__(self, token: str, base_id: str):
        self.base_id = base_id
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )

    def _url(self, table: str) -> str:
        return f"https://api.airtable.com/v0/{self.base_id}/{requests.utils.quote(table)}"

    def list_all(self, table: str, fields: Optional[list] = None) -> list:
        records = []
        params = {}
        if fields:
            params["fields[]"] = fields
        offset = None
        while True:
            if offset:
                params["offset"] = offset
            resp = self.session.get(self._url(table), params=params)
            resp.raise_for_status()
            data = resp.json()
            records.extend(data.get("records", []))
            offset = data.get("offset")
            if not offset:
                break
        return records

    def create_batch(self, table: str, records: list) -> list:
        created = []
        for i in range(0, len(records), 10):
            chunk = records[i : i + 10]
            payload = {"records": [{"fields": r} for r in chunk], "typecast": True}
            resp = self.session.post(self._url(table), json=payload)
            if resp.status_code == 429:
                time.sleep(int(resp.headers.get("Retry-After", "5")))
                resp = self.session.post(self._url(table), json=payload)
            resp.raise_for_status()
            created.extend(resp.json()["records"])
            time.sleep(0.25)  # fica bem dentro do limite de 5 req/s da API
        return created


def parse_parcela(reason: str):
    """Extrai (motivo_limpo, atual, total) de um texto como 'Oculos — Parc 6/12'."""
    m = PARCELA_RE.search(reason or "")
    if not m:
        return reason, None, None
    atual, total = int(m.group(1)), int(m.group(2))
    motivo = PARCELA_RE.sub("", reason).strip()
    return motivo or None, atual, total


def build_grupo_parcela(payer: str, categoria: str, motivo_limpo: str, total: int) -> str:
    base = motivo_limpo or categoria
    return f"{slugify(payer)}-{slugify(base)}-{total}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_path")
    parser.add_argument("--dry-run", action="store_true", help="so mostra o plano, nao cria nada")
    parser.add_argument(
        "--fix-month-from-date",
        action="store_true",
        help="usa o mes derivado de `date` em vez do campo `month` do export",
    )
    args = parser.parse_args()

    token = os.environ.get("AIRTABLE_TOKEN")
    base_id = os.environ.get("AIRTABLE_BASE_ID", DEFAULT_BASE_ID)
    if not token:
        die("defina AIRTABLE_TOKEN no ambiente antes de rodar (o mesmo PAT do index.html serve)")

    with open(args.export_path, "r", encoding="utf-8") as f:
        export = json.load(f)

    at = Airtable(token, base_id)
    mode = "[DRY-RUN] " if args.dry_run else ""

    # ---- 1. Meses: upsert por MesID ----
    print("Lendo meses existentes no Airtable...")
    existing_meses = at.list_all(MESES_TABLE, fields=["MesID"])
    mes_to_record_id = {
        r["fields"].get("MesID"): r["id"] for r in existing_meses if r["fields"].get("MesID")
    }

    novos_meses = []
    for mes_id, info in export["months"].items():
        if mes_id in mes_to_record_id:
            continue
        novos_meses.append({"MesID": mes_id, "ValorMensal": info.get("valorMes", 0)})

    if novos_meses:
        print(f"{mode}Criando {len(novos_meses)} mes(es) novo(s): {[m['MesID'] for m in novos_meses]}")
        if not args.dry_run:
            created = at.create_batch(MESES_TABLE, novos_meses)
            for rec in created:
                mes_to_record_id[rec["fields"]["MesID"]] = rec["id"]
        else:
            # em dry-run, assume ids fake so o resto do plano pode ser simulado
            for m in novos_meses:
                mes_to_record_id[m["MesID"]] = f"<novo:{m['MesID']}>"
    else:
        print("Nenhum mes novo a criar (todos ja existem).")

    # ---- 2. Lancamentos: upsert por OrigemImportID ----
    print("Lendo lancamentos existentes no Airtable (checando duplicatas)...")
    existing_lanc = at.list_all(LANCAMENTOS_TABLE, fields=["OrigemImportID"])
    ja_migrados = {
        r["fields"].get("OrigemImportID")
        for r in existing_lanc
        if r["fields"].get("OrigemImportID")
    }

    novos = []
    pulados = 0
    sem_mes = []
    mes_ajustado = []
    for p in export["payments"]:
        origem_id = p.get("_id")
        if origem_id and origem_id in ja_migrados:
            pulados += 1
            continue

        mes_id = p["month"]
        if args.fix_month_from_date and p["date"][:7] != mes_id:
            mes_ajustado.append((origem_id, mes_id, p["date"][:7]))
            mes_id = p["date"][:7]

        if mes_id not in mes_to_record_id:
            sem_mes.append(p)
            continue

        motivo_limpo, atual, total = parse_parcela(p.get("reason", ""))
        grupo = None
        if total:
            grupo = build_grupo_parcela(p["payer"], p["category"], motivo_limpo, total)

        fields = {
            "Data": p["date"],
            "Mes": [mes_to_record_id[mes_id]],
            "Valor": p["value"],
            "Categoria": CATEGORIA_LABELS.get(p["category"], p["category"]),
            "QuemPagou": p["payer"],
            "Motivo": motivo_limpo or CATEGORIA_LABELS.get(p["category"], p["category"]),
            "OrigemImportID": origem_id or f"sem-id-{mes_id}-{p['date']}",
        }
        if atual is not None:
            fields["ParcelaAtual"] = atual
            fields["ParcelaTotal"] = total
            fields["GrupoParcela"] = grupo
        novos.append(fields)

    if mes_ajustado:
        print(f"{mode}Mes corrigido pela data em {len(mes_ajustado)} lancamento(s):")
        for origem_id, mes_original, mes_novo in mes_ajustado:
            print(f"  - {origem_id}: {mes_original} -> {mes_novo}")

    if sem_mes:
        print(
            f"AVISO: {len(sem_mes)} lancamento(s) referenciam um mes que nao existe "
            "no export['months'] (nao migrados). Exemplos:",
            file=sys.stderr,
        )
        for p in sem_mes[:5]:
            print(f"  - {p.get('_id')}: month={p['month']!r}", file=sys.stderr)

    print(f"Pulados (ja migrados anteriormente): {pulados}")
    if novos:
        print(f"{mode}Criando {len(novos)} lancamento(s) novo(s).")
        if args.dry_run:
            for f in novos[:15]:
                print(f"  - {f['Data']} | {f['Categoria']:16s} | R$ {f['Valor']:>8.2f} | {f['QuemPagou']:8s} | {f['Motivo']}")
            if len(novos) > 15:
                print(f"  ... e mais {len(novos) - 15}.")
        else:
            at.create_batch(LANCAMENTOS_TABLE, novos)
    else:
        print("Nenhum lancamento novo a criar.")

    print(f"\n{mode}Migracao {'simulada' if args.dry_run else 'concluida'}.")


if __name__ == "__main__":
    main()
