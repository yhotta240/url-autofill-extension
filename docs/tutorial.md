---
id: tutorial
title: チュートリアル
order: 2
visible: true
expanded: false
date: 2026-10-20
---

## name / id による指定

```text
https://example.com/form#url-autofill:email=test%40example.com
```

対象ページのURL末尾に `#url-autofill:` を付け，`項目名=値` を指定する．複数項目は `&` で区切る．
まず `name` 属性を検索し，該当要素がない場合に `id` 属性を検索する．同じ属性値が複数要素に一致した場合は入力しない．

```text
https://example.com/form#url-autofill:name=Tanaka&email=test%40example.com
```

## CSSセレクタによる指定

```text
https://example.com/form#url-autofill:fill(%23email)=test%40example.com
```

`fill(...)` は括弧内のCSSセレクタに一致する要素を指定する．複数要素に一致する場合や，セレクタが不正な場合は入力しない．

項目名・セレクタ・値に含まれる予約文字や日本語は `encodeURIComponent()` でURLエンコードする．`+` は空白として扱うため，文字としての `+` は `%2B` にする．

## 入力値

| 対象 | 指定方法 |
| --- | --- |
| input の text / email / search | 文字列 |
| input の number | 数値文字列（例：`123`） |
| input の date | `YYYY-MM-DD` 形式（例：`2026-10-20`） |
| textarea | 文字列（改行は `%0A`） |
| select | option の `value`（複数選択欄でも1つだけ選択） |
| checkbox | `true` / `1` でチェック，`false` / `0` / 空文字で解除 |
| radio | 指定した要素の `value` と同じ値で選択，空文字で解除 |

同じキーを複数指定した場合は最後の値を使う．空文字は入力欄を空にする．select は空値の選択肢があればそれを選択し，なければ選択を解除する．不正な数値・日付は既存値を変更しない．

ラジオボタンやチェックボックスで同じ `name` を持つ要素が複数ある場合は，`fill(...)` で1つに絞る．例えば `value="plan-b"` のラジオボタンを選ぶ場合は次のように指定する．

```text
https://example.com/form#url-autofill:fill(input%5Bname%3D%22plan%22%5D%5Bvalue%3D%22plan-b%22%5D)=plan-b
```

## SPA・動的フォーム

ハッシュルートを使うページでは，既存のフラグメントの後ろに指定を追加する．

```text
https://example.com/#/settings#url-autofill:email=test%40example.com
```

自動入力用の指定は入力前にURLから除去する．残りのURLと履歴のstateは保持する．SPA内では `hashchange` を監視し，新しい指定を処理する．

入力欄とselectの選択肢が遅れて追加される場合は最大10秒待機する．入力済みの項目は再入力しない．別のURLへ移動した場合や，ページを離れた場合は古い処理を中止する．

## 制限と注意点

- URL長は16,384文字，項目数は100件までとする．上限超過や不正なURLエンコードでは入力しない．
- パスワード，ファイル，hidden，送信ボタンなどの非対応型と，disabled / readonly の入力欄は変更しない．
- `autocomplete` がパスワード，ワンタイムコード，クレジットカード情報を示す欄も変更しない．
- iframe，Shadow DOM，contenteditable は非対応である．
- 拡張機能自体はクリック・フォーム送信・入力値の保存・外部送信を行わない．入力後に `input` / `change` を発火するため，ページ側のイベント処理は動作する．
- URLを除去する前にページ側のスクリプトから参照される可能性があるため，機密情報は指定しない．
- Chromeの内部ページやChrome Web Storeなど，Content Scriptを実行できないページは対象外である．
- サイト独自の入力制御によっては値が反映されない場合がある．

処理結果はページのコンソールへ件数と失敗理由のみ出力する．項目名・セレクタ・入力値はログへ出力しない．

## 開発時の確認

```bash
npm test
npm run test:watch
npm run build
npm run build:dev
npm run watch
```

`npm test` はVitestでテストを1回実行し，`npm run test:watch` は変更を監視してテストを再実行する．

`watch` は変更時に再ビルドする．ビルド後は `chrome://extensions/` で拡張機能を更新し，対象ページを再読み込みする．
