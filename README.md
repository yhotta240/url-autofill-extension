# URL AutoFill

URLを開くだけで，指定した内容をWebフォームへ自動入力できるChrome拡張機能です．

## 主な機能

- URLを開くだけで，指定した内容をフォームへ自動入力
- 入力先と値を指定して，自動入力用のURLを作成・コピー
- よく使うURLを名前付きで保存し，一覧から開いて再利用

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

拡張機能の画面で「URL AutoFill を有効にする」をオンにしてから，対象のURLを開いてください．初期状態はオフです．

設定タブで入力欄と値を指定し，URLを作成・コピーできます．「項目を追加」で複数の入力欄を指定し，「保存」で名前を付けて一覧に残せます．URLの作成・保存は自動入力がオフでも利用できます．

対象ページのURL末尾に `#url-autofill:` と入力項目を指定します．複数の項目は `&` で区切ります．

```text
https://example.com/form#url-autofill:name=Tanaka&email=test%40example.com
```

通常は `name` 属性，次に `id` 属性で入力欄を特定します．CSSセレクタで指定する場合は `fill(...)` を使用します．

```text
https://example.com/form#url-autofill:fill(%23email)=test%40example.com
```

セレクタと値はURLエンコードします．パスワードなどの機密情報は指定しないでください．

操作手順は，[チュートリアル](docs/tutorial.md)を確認してください．

## ライセンス

MIT License

## 作者

yhotta240
