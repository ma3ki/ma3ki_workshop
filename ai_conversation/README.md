# AI Conversation System (ai_conversation)

マルチプロバイダー対応の LLM 連携および音声合成（TTS）を備えた、キャラクター対話型受付システムです。
**さくらのAI Engine** や外部 AI API を組み合わせ、高い冗長性とキャラクターごとの柔軟なカスタマイズを実現しています。

## 🌟 主な特徴

- **マルチ LLM プロバイダー & 自動フォールバック**:
  - **さくらのAI Engine (GPT-OSS)** をメインに、Gemini (2.5-flash 対応) や Groq (動作未確認) に対応しています。
  - メインのプロバイダーがダウンした際、自動的に予備のプロバイダーへ切り替える二重ループ処理による冗長化を実装しています。
- **ハイブリッド音声合成 (TTS)**:
  - さくら TTS および Edge-TTS に対応しています。
  - 感情タグに応じた表情変化と口パク（リップシンク）の連動が可能です。
- **キャラクター別管理**:
  - `characters.json` により、システムプロンプト、感情リスト、使用モデル、音声設定、固定音声（wav）をキャラクター単位で完全に分離管理しています。
- **障害耐性**:
  - API エラーやリミット到達時に、キャラクターごとの固有メッセージと固定音声でお詫びをするフォールバック機能を搭載しています。

## 🛠 動作環境 / 依存関係

- **Backend**: Python 3.9+, FastAPI, Uvicorn, HTTPX (Async)
- **AI/TTS**: edge-tts, Pydantic, python-dotenv
- **Frontend**: Vanilla JS, Web Speech API (音声認識)

## 🚀 セットアップ手順

### 1. 依存ライブラリのインストール
```bash
pip install fastapi uvicorn httpx python-dotenv edge-tts pydantic
```

### 2. 環境変数の設定 (.env)
プロジェクトルートに `.env` ファイルを作成し、各種 API キーを設定します。

```env
SAKURA_API_KEY=your_sakura_api_key
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
DEFAULT_CHARACTER=ma3ki
```

### 3. サーバーの起動
```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

## 🖼 アセット配置と命名規則

各キャラクターのアバター画像は `static/media/{character_id}/` ディレクトリに配置してください。

### 画像ファイルの命名ルール
プログラム（`audio.js`）が瞬きや口パクを制御するため、以下の規則に従って `webp` 形式で作成してください。

**ファイル名形式**: `{感情}_mouse_{口の状態}_eye_{目の状態}.webp`

### normal 表情で最低限必要な 4 ファイル
キャラクターを追加する際、最低限以下の 4 ファイルを準備することで、自然な瞬きと口パクが動作します。

| ファイル名 | 内容 |
| :--- | :--- |
| normal_mouse_close_eye_open.webp | 基本の立ち絵（口閉じ・目開き） |
| normal_mouse_close_eye_close.webp | 瞬き用（口閉じ・目閉じ） |
| normal_mouse_open_eye_open.webp | 発話中（口開き・目開き） |
| normal_mouse_open_eye_close.webp | 発話中の瞬き（口開き・目閉じ） |

※ 他の感情（happy, angry 等）を追加する場合も、同様のパターンが必要です。

## 📂 ディレクトリ構造

- **server.py**: FastAPI によるバックエンド。LLM/TTS のオーケストレーション。
- **static/**: フロントエンド資産（HTML, CSS, JS）。
  - **js/audio.js**: アバターの表情制御と音声再生ロジック。
  - **js/chat.js**: API 通信および履歴管理。
- **config/characters.json**: 全キャラクターの振る舞い定義。
- **media/**: 画像および固定音声アセット。

---

## 📝 免責事項 (Disclaimer)
本リポジトリのコードはエイプリルフールのジョーク企画および学習目的で作成されたものです。
本ソフトウェアの使用によって生じた、いかなる損害についても作者は一切の責任を負いません。
技術的な「インチキ」が含まれている可能性がありますので、本番環境でのご利用は計画的に。

## ⚖ ライセンス (License)
[MIT License](LICENSE)
