# 速さの試験の手順 — 本番の依存の版上げ（Issue #339）

- 入力: 機能以外の要件 `construction/nfr-requirements/performance-requirements.md`（NFR1.3）、試験の手順 `construction/code-generation/unit-test-instructions.md`

## 対象

- この取り組みは速さの目標を新しく作らず、今の目標も変えない（NFR1.3）。プログラムを変えないので、速さの変化は部品の版の変化からだけ起こりうる。
- 確かめは「今の試験が、試験の中の待ち時間を変えずに通る」こと。負荷の試験・速さの比べは作らない（性能の確かめの段はこの取り組みの計画に無い）。

## 動かし方

- `construction/code-generation/unit-test-instructions.md` の T1〜T11 をそのまま動かす。待ち時間の設定は変えない。
- 合格: すべて 0 で終わる。

## 測らない物

- 道具の応答の時間の分布、起動の時間の版上げの前と後の比べ。新しい目標が無いため（performance-requirements.md の「測らない物」）。
