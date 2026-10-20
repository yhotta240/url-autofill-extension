---
id: tutorial
title: チュートリアル
order: 2
visible: true
expanded: false
date: 2026-10-20
---

## 開発中

URL AutoFill の自動入力機能は未実装である．以下は実装予定のURL形式である．

## name / id による指定

```text
https://example.com/form#url-autofill:email=test%40example.com
```

## CSSセレクタによる指定

```text
https://example.com/form#url-autofill:fill(%23email)=test%40example.com
```

セレクタと値はURLエンコードする．パスワードなどの機密情報は指定しない．
