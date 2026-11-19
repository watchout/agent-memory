# U1 の観測の設計

- 入力: 観測の要件（`construction/u1-seat-memory-skeleton/nfr-requirements/observability-requirements.md` の NFR1.1・NFR5.6・NFR5.7・NFR9.1）、取り決め（`inception/contract-design/contract-summary.md` の C1 の errors・C2）、決まり（`construction/u1-seat-memory-skeleton/functional-design/rules.md` の BR2.5）

## 呼出しの記録

- 置き場所: 今のまま `~/.agent-memory/calls.log`。1 行 1 件の JSON。

```json
{"tool":"log_decision","record_refs":["<decision_id>"],"at":"2026-10-23T01:56:04Z","outcome":"ok"}
{"tool":"log_decision","record_refs":[],"at":"2026-10-23T01:56:05Z","outcome":"error:placement_unreachable"}
```

- 項目はこの 4 つだけ（NFR1.1）。決定の文・作業の名前・学びの題・資格情報は書かない。

## 失敗の名前の写し

共通基盤の失敗の番号を、Kusabi の失敗の名前に写す表を 1 か所に置く（BR2.5、設計・実装の標準 S3）。

| 共通基盤 | 意味 | Kusabi の失敗の名前 |
|----------|------|-------------------|
| OC001 | invalid_input | invalid_input |
| OC002 | unauthenticated | seat_not_registered |
| OC003 | forbidden | no_membership |
| OC004 | not_found | seat_not_registered |
| OC005 | not_initialized | not_initialized |
| OC006 | unbound | binding_closed |
| OC007 | retired | binding_closed |
| OC008 | stale | binding_closed |
| OC009 | incompatible | not_initialized |
| OC010 | conflict | invalid_input |
| OC011 | unavailable | placement_unreachable |

- 道具の失敗は、この名前を文の先頭に置いて返す（NFR5.6）。共通基盤の文（PostgreSQL の message）はそのまま席に渡さない。
- 起動の口の出力には memory_status（ok・unreachable・not_registered・not_initialized・skipped_deadline）を出す（NFR5.7）。

## 時刻と順序

- 記録の時刻は UTC で時差つきで保つ。読み出しの並びは「時刻の新しい順、同じ時刻は決定の ID の順」で、毎回同じになる（NFR9.1）。
- 外の監視のサービスへの送り出しはしない。
