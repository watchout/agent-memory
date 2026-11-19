# 流れの文書 — 席の記憶に影響する外の流れと決まり

前の段階の意図の文書（`ideation/intent-capture/intent-statement.md`）で決めた最初の版（社内の開発の席で使い始め、顧客ごとに自社か顧客の DB のどちらか一方に置く）に影響する、外の流れと決まりをまとめます。挙げたのは質問 Q3 の答え（A・B・C）の 3 つと、調べる中で見つけた 1 つです。情報は 2026-10-22 に確認したものです。

## 流れ 1 — 顧客のデータを顧客の管理下に置く求め（Q3 の A）

- 個人情報保護法は、外国にある第三者に個人データを渡す時の決まりを持ち、個人情報保護委員会がガイドライン（外国にある第三者への提供編）を出している。原則として本人の同意か、決められた条件が要る。出典: [個人情報保護委員会 ガイドライン（外国にある第三者への提供編）](https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/)
- 席の記憶に顧客の仕事の中身（施設や宿泊のお客様の情報など）が入れば、記憶を外国の事業者のサービスに置くことは、この決まりの確認が要る場面になりうる。自社か顧客の DB の中で完結させれば、その確認の範囲を小さくできる。（私の読み。法的な判断ではなく、確認が要るという指摘）
- 意味すること: 意図の文書の「顧客ごとに自社か顧客の DB のどちらか一方に置く」は、この流れに沿う。

## 流れ 2 — 1 つの仕事を種類の違う AI で分担する使い方（Q3 の B）

- AI の道具が外の機能を呼ぶ共通のつなぎ方（MCP）は、2025-12-09 に Linux Foundation の下に新しく作られた Agentic AI Foundation に寄贈された。発表は、MCP が ChatGPT・Cursor・Gemini・Microsoft Copilot・Visual Studio Code などに組み込まれていると書く。出典: [Linux Foundation の発表](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- 同じ発表で、OpenAI の AGENTS.md（席への指示を書く共通の形）も同じ基金に入った。Claude Code も AGENTS.md を読める。出典: 同上、[Claude Code の文書](https://code.claude.com/docs/en/memory)
- 意味すること: 種類の違う席が同じつなぎ方で同じ記憶を呼ぶ形が、業界の共通の形になりつつある。条件 B（種類の違う AI の席から同じ記憶を使う）を共通のつなぎ方で満たせば、席の種類が増えても作り直しが少ない。

## 流れ 3 — AI の道具が記憶の機能を持ち始めている（Q3 の C）

- Claude Code は auto memory を手元の会話で既定で有効にし、リポジトリごとに機械の中に記憶を置いて、毎回の会話の最初に読む。機械やクラウドの間では共有しない。出典: [Claude Code の文書](https://code.claude.com/docs/en/memory)
- Codex は Memories を持ち、既定では切ってある。有効にすると `~/.codex/memories/` に置き、利用者ごと・機械ごとで、機械の間では移らない。出典: [Codex Memories の文書](https://learn.chatgpt.com/docs/customization/memories?surface=app)
- 意味すること: 「1 つの席が同じ機械で会話を続ける」記憶は道具の側で当たり前になりつつある。Kusabi が自前で持つ意味は、道具の記憶が届かない所（機械をまたぐ、種類の違う席に引き継ぐ、自社か顧客の DB に置く、置き場所と読み書きの一覧を出す）に移る。比べる相手として意識し続ける（Q3 の答え）。

## 流れ 4 — 外の記憶の製品の多くは、記憶を足す時に外の LLM を使う

- Mem0 は既定で、記憶を足す時にメッセージを LLM に送って事実を抜き出す（抜き出さずにそのまま保存する設定もある）。自前で動かす版の既定の LLM は OpenAI。出典: [Mem0 の文書（記憶の追加）](https://docs.mem0.ai/core-concepts/memory-operations/add)、[Mem0 の文書（Open Source）](https://docs.mem0.ai/open-source/overview)
- Zep の Graphiti は取り込みに LLM が必須で、既定は OpenAI。出典: [Graphiti の GitHub](https://github.com/getzep/graphiti)
- 意味すること: 置き場所を自社の DB にしても、記憶の中身が外の LLM へ渡る道が別に残る。条件 A（自社・顧客の管理の外に出さない）を守るには、記憶を足す時に外の LLM を呼ばない形か、呼ぶならその扱いを決める必要がある。（LLM の呼出しの扱いは、iyasaka-arc#49 6328010677 の決定で「含まないもの」とされており、後の段階で決める）

## 確かめていないこと

- 流れ 1 の決まりが、席の記憶に入る中身（どの情報が個人データに当たるか）にどこまで掛かるか。法務の確認が要る。
- 顧客企業の情報システムの担当が、置き場所について社内の決まり（国内に置く、特定の雲の上に置く、など）を持っているか。顧客ごとに聞く必要がある。
