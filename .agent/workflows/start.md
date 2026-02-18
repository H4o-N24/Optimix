---
description: Knot Discord Botの起動手順
---

# Knot Bot 起動手順

## 前提条件
- `.env` ファイルに `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` が設定済みであること
- `npm install` が実行済みであること
- `npx prisma migrate dev` でDBが初期化済みであること

## 起動コマンド

// turbo
1. nvmを読み込んで開発モードで起動する
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm run dev
```

## 起動成功の確認
以下のようなログが表示されれば成功:
```
✅ Knot がオンラインになりました！ Knot#XXXX としてログイン中
📡 N サーバーに接続中
🔧 3 コマンドをギルド XXXX に登録しました
```

## 停止
- ターミナルで `Ctrl+C` を押す

## トラブルシューティング
- **`環境変数が未設定です`**: `.env` ファイルの `DISCORD_TOKEN` と `CLIENT_ID` を確認
- **`npm: command not found`**: `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"` を先に実行
- **DB関連エラー**: `npx prisma migrate dev` を再実行
