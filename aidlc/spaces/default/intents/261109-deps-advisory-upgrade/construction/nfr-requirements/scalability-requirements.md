# 規模の要件 — 本番の依存の版上げ（Issue #339）

- 入力: 承認された要件（`inception/requirements-analysis/requirements.md` の NFR1）、この段の要約の確かめ（`nfr-requirements-questions.md`）

## 目標

- この取り組みは、扱う席の数・記録の数・同時の接続の数の目標を変えない。プログラムと置き場の扱いを変えないため（要件 NFR1）。新しい要件の ID は作らない。

## 変えない物

- 席ごとに 1 つの MCP の server（stdio）の形、SQLite と PostgreSQL の置き場の扱い、接続の数。
- 規模の確かめは、今の試験が通ること（速さの要件 NFR1.3、壊れにくさの要件 NFR1.1）で足りる。
