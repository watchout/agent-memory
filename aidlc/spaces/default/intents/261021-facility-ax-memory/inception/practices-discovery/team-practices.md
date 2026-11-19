# チームの進め方

> 2026-10-22 の面談（practices-discovery-questions.md）で確かめた、このリポジトリ（Kusabi）の開発の進め方。

## Way of Working

- 変更ごとに branch を切り、main へ PR を出す。main へ直接 commit しない。branch の名前は、担当の印（agent/・codex/・fix/・chore/・kusabi/・arc/ など）で始める。
- PR は、独立の監査（devauditor）が PASS したあと、作者と別の席（suite-lead）が head の一致を確かめて統合する（T129）。作者は自分の PR を承認・監査・統合しない。
- 統合の方式は merge commit にそろえる（Shirube・AUN と同じ）。元に戻す時は、その merge commit を戻す。
- 保護面（DB の作りの変更・席の起動・展開・workflow・資格情報など）は、owner の決定（exact-head か明示の認可）が無いと進めない。
- commit の文は Conventional commits で書く（feat:・fix:・refactor:・docs:・test:・chore:）。

## Walking Skeleton

- 取り組みの最初の作業の単位は、端から端まで通る薄い一本にする（Shirube・AUN と同じ）。動くことを owner が確かめてから、残りの単位に進む。
- 今回の取り組みでは、「Codex の席が決定を 1 件書き、再起動の後に Claude Code の席が同じ記憶をその DB から読み戻す」所までを最初に通す。いちばん不確かな所（種類の違う席から同じ記憶を使う P2）から始める決定（D-28）に合わせる。

## Testing Posture

- **Methodology**: custom
- **Methodology evidence**: 成功の条件は「担当交代と再起動の場面を決めた試験で取り出せる割合 100%」（D-06・D-26・D-27）なので、その場面の試験を先に固めて完了の判定をぶれさせない。細かい試験は、今の自前の tsx のスクリプトの形に合わせて実装の後に書く（面談の Q3 = C）。
- **Ordering**: 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。
- 網羅率の床は置かない。要件ごとに試験を 1 つ以上置き、成功の条件の場面の試験がすべて通ることで判定する（面談の Q4 = B）。網羅率を測る道具は足さない。
- PostgreSQL の試験は、最初は手元で回し、結果を PR に証拠として載せる。置き場所の設計が固まった所で CI に入れる。CI の workflow を変える時は owner の exact-head を得る（面談の Q5 = C）。
- CI（.github/workflows/ci.yml）は Node 18・20・22 で型検査・ビルド・試験を回す。今ある試験は通ったまま保つ。

## Deployment

- 統合された main から中身の決まった版（content-addressed の runtime release）を作り、席の束ごとに R1 → R2 → R3 の順で配る。各束はすべての席が健全と観測されてから次の束へ進み、失敗した束は設定を元に戻す。
- 記憶の置き場所を新しい所へ切り替える前に、元の置き場所へ戻す手順を一度試しておく（面談の Q6 = B、Shirube 開発規格 S6）。
- 席の起動・展開は保護面で、owner の認可を得てから行う。npm への公開はまだしない。

## Code Style

- TypeScript ESM。1 ファイル 400 行を目安・最大 800 行。絵文字を使わない。オブジェクトや配列を直接書き換えない。境目で try/catch する。入力は zod で確かめる。コメントは最小限にする（CLAUDE.md）。
- 書式・静的検査の道具は足さず、型検査（tsc の strict）と上の決まりで進める（面談の Q7 = A）。道具を足すなら、新しい外部の依存として owner が別に決める。
- 800 行を超える今のファイル（7 つ）は、触る時に直す。まとめて直す計画は作らない（設計・実装の標準「既にあるものは触る時に直す」）。
