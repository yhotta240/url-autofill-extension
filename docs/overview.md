---
id: overview
title: 概要
order: 1
visible: true
expanded: true
date: 2026-10-20
---

## URL AutoFill

URLフラグメントに指定した情報をWebフォームへ自動入力するChrome拡張機能．

## 主な機能

- `#url-autofill:` を使った入力情報の指定
- `name` / `id` 属性と `fill(...)` による入力欄の特定
- フォームを送信せず，指定した項目のみ自動入力
- URLから自動入力用パラメータを除去し，動的に追加される入力欄を最大10秒待機

## 制限

- パスワード，ファイル，非対応の入力型，無効・読み取り専用の欄は変更しない
- 対象が複数一致する場合は入力しない
- iframe，Shadow DOM，contenteditable は対象外
- 入力情報は保存・送信せず，ログにも出力しない
