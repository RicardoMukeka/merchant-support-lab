"""Eval mínimo do chatbot, em Python (a linguagem de quem faz avaliação de IA).

Uso (com a API rodando: npm run dev):
    python3 evals/run_evals.py

Só usa a biblioteca padrão. Chama POST /webhook/chat assinando com HMAC, como o provedor faria.

IDEIA CENTRAL: LLM não tem "teste unitário" determinístico. Você mede uma TAXA de acerto num
conjunto fixo de perguntas e compara antes/depois de cada mudança (prompt, chunking, modelo).
Sem isso, "melhorou" é só impressão.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

BASE = os.environ.get("LAB_URL", "http://localhost:3000")
SECRET = os.environ.get("WEBHOOK_SECRET", "troque-me").encode()


def ask(question: str) -> str:
    body = json.dumps({"merchantId": "m-eval", "text": question}).encode()
    sig = hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        f"{BASE}/webhook/chat",
        data=body,
        headers={"content-type": "application/json", "x-signature": sig},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["reply"]


def check(case: dict, reply: str) -> list[str]:
    errors = []
    for needle in case["must_contain"]:
        if needle.lower() not in reply.lower():
            errors.append(f"faltou: {needle!r}")
    for pattern in case["must_not_contain"]:
        if re.search(pattern, reply):
            errors.append(f"não devia conter: {pattern!r}")
    return errors


def main() -> int:
    cases = [json.loads(l) for l in Path(__file__).with_name("dataset.jsonl").read_text().splitlines() if l.strip()]
    failed = 0
    for case in cases:
        reply = ask(case["question"])
        errors = check(case, reply)
        failed += bool(errors)
        print(f"[{'FAIL' if errors else 'ok  '}] {case['id']}: {case['question']}")
        for e in errors:
            print(f"        {e}")
    total = len(cases)
    print(f"\nacerto: {total - failed}/{total} ({100 * (total - failed) // total}%)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
