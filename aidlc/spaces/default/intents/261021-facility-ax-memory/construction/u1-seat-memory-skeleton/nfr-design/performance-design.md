# U1 の速さの設計

- 入力: 速さの要件（`construction/u1-seat-memory-skeleton/nfr-requirements/performance-requirements.md` の NFR4.1〜NFR4.4・NFR5.2）、振る舞いの仕様（`construction/u1-seat-memory-skeleton/functional-design/functional-spec.md` の W2〜W4）、取り決め（`inception/contract-design/contract-summary.md` の C2・C4）

## 時間の予算

| 区切り | 予算 | 仕組み |
|--------|------|--------|
| 起動の口の全体（NFR4.1） | 7 秒 | 起動の口が締め切りの時刻を 1 つ持ち、各段の時間をそこから引く。締め切りを過ぎたら回復を打ち切り、memory_status を出して返す |
| 起動の口の接続（NFR4.2） | 2 秒 | 接続の待ちの上限を 2 秒にする。届かなければ unreachable |
| 起動の口の確かめと読み出し（NFR4.3） | 3 秒 | 取引の中の文の処理の上限を 3 秒にする |
| 道具の 1 回の DB の処理（NFR5.2） | 5 秒 | 取引ごとに文の処理の上限を 5 秒、待ちの上限を 1 秒にする（取引の中だけに効く形で付ける） |

```text
deadline = start + 7s
connect(timeout = min(2s, deadline - now))
inTransaction(statement_timeout = min(3s, deadline - now)):
  verify seat; read active decisions
if now > deadline: return { memory_status: "skipped_deadline" }
```

## 道具の速さ（NFR4.4）

- 1 回の書き込みは、Kusabi の公開関数の 1 回の呼出し（確かめ + 1 件の保存）。往復は 1 回。
- 読み出しは、決定の表の「席・所属範囲・状態・時刻の新しい順」の索引で、席の active の決定を新しい順に読む。件数の上限は道具の引数（既定は今の版と同じ）。
- 先に読んでおく写し（cache）は持たない。正は DB で、古い写しで答えない（NFR5 の「観測できず」を補わない）。
- 測り方: 試験の DB に合成の決定を 1 万件入れ、書く・読むを 100 回ずつ流し、95 番目の値が 500 ミリ秒以内であることを試験で確かめる。
