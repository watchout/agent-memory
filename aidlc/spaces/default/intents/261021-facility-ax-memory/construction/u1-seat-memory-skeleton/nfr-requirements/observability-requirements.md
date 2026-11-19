# U1 の観測の要件

- 入力: 要件（`inception/requirements-analysis/requirements.md` の NFR1・NFR5・NFR9）、取り決め（`inception/contract-design/contract-summary.md` の C1 の errors）

## 記録と失敗の名前

| ID | 要件 | 確かめ方 |
|----|------|----------|
| NFR1.1 | 呼出しの記録（手元のファイル）は、道具の名前・記録の ID・時刻・結果（成功か失敗の名前）だけ。中身を書かない | 試験で、記録の 1 行の項目がこの 4 つだけ |
| NFR5.6 | 道具の失敗は、取り決め C1 の失敗の名前（seat_not_registered・no_membership・binding_closed・placement_unset・placement_unreachable・not_initialized・not_yet_available・invalid_input）を文の先頭に置いて返す | 試験で、それぞれの失敗の場面で名前が返る |
| NFR5.7 | 起動の口の出力に memory_status（ok・unreachable・not_registered・not_initialized）を出す | 試験で、それぞれの場面の起動の口の出力に出る |
| NFR9.1 | 記録の時刻は UTC で時差つきで保ち、同じ時刻の決定は決定の ID で順を決める | 試験で、同じ時刻の決定を読む順が毎回同じ |

## 外への送り出し

- 外の監視のサービス・外への記録の送り出しはしない（NFR1.2）。観測は手元の呼出しの記録と、道具・起動の口の応答の失敗の名前だけ。
- 回復の質の記録（何をいくつ返したか）は U3 で足す。
