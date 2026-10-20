# URL AutoFill

URLフラグメントに指定した情報をWebフォームへ自動入力するChrome拡張機能です．

## 主な機能

- URLを開くだけで，指定したフォーム項目へ自動入力
- `name` / `id` 属性による入力欄の指定
- `fill(...)` によるCSSセレクタの明示指定
- 入力前にURLから自動入力用のパラメータを除去
- 動的に追加される入力欄やSPA内のURL変更への対応
- フォームを送信せず，指定した項目のみ入力

## インストール

### 手動インストール

Node.js `^22.12.0 || >=24.0.0` と npm が必要です．

1. このリポジトリをクローン

   ```bash
   git clone https://github.com/yhotta240/url-autofill-extension.git
   cd url-autofill-extension
   ```

2. 依存関係をインストール

   ```bash
   npm ci
   ```

3. ビルド

   ```bash
   npm run build
   ```

4. Chrome に読み込む
   - Chrome で `chrome://extensions/` を開く
   - 「デベロッパーモード」をオンにする
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - `dist/` ディレクトリを選択

## 使い方

対象ページのURL末尾に `#url-autofill:` と入力項目を指定します．複数の項目は `&` で区切ります．

```text
https://example.com/form#url-autofill:name=Tanaka&email=test%40example.com
```

通常は `name` 属性，次に `id` 属性で入力欄を特定します．CSSセレクタで指定する場合は `fill(...)` を使用します．

```text
https://example.com/form#url-autofill:fill(%23email)=test%40example.com
```

セレクタと値はURLエンコードします．パスワードなどの機密情報は指定しないでください．

詳しいURL形式は，[チュートリアル](docs/tutorial.md)を確認してください．

## ライセンス

MIT License

## 作者

yhotta240
