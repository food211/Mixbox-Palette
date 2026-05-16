# 🎨 Mixbox Palette for Adobe Photoshop（日本語）

[English](README.md) · [中文](README.md#-mixbox-调色板---adobe-photoshop-插件) · 日本語

Adobe Photoshop 用の UXP プラグイン。**本物の絵具のように混色できる**水彩パレットを Photoshop に追加します。デュアル物理混色エンジン搭載。

![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)
![Mixbox License](https://img.shields.io/badge/Mixbox-CC%20BY--NC%204.0-lightgrey.svg)

<img src="./assets/gifs/red_blue_yellow.gif" alt="赤・青・黄の混色" width="480">

*本物の減色混合 —— 黄+青=緑、濁った灰色になりません。*

---

## なぜ Mixbox Palette か

Photoshop 標準のブラシで水彩を描こうとすると、青と黄を混ぜたら濁った緑、深紅を薄めたら灰色になってしまう —— これは Photoshop が **RGB の加法混色（光の混色）** で計算しているためで、**実際の絵具の減法混色** とは別物です。

このプラグインは [Mixbox](https://scrtwpns.com/mixbox/) と独自実装の Kubelka-Munk エンジンを使い、**本物の顔料が混ざるときの物理特性** を Photoshop の中で再現します。透明水彩、ガッシュ、油彩のような感覚で、レイヤーを重ねたり、キャンバス上で直接混色できます。

---

## 水彩ブラシ

<img src="./assets/gifs/watercolor.gif" alt="水彩のストローク" width="480">

水彩ブラシを重ねると自然に滲み合います。ウェットエッジ、柔らかい移行、濃度調整（1–100）対応。

## キャンバス上で混色（スマッジ）

<img src="./assets/gifs/watercolor_mix.gif" alt="スマッジツールで水彩を混色" width="480">

スマッジツールでキャンバス上の色を直接混ぜられます。パレットで絵具を練るのと同じ感覚。

## 明度ルーラー

<img src="./assets/gifs/value_ruler.gif" alt="明度ルーラー" width="480">

色をピックすると、その色の知覚明度がルーラー上に表示されます。明度コントロールがしやすくなります。

## 可変サイズのキャンバス

<img src="./assets/gifs/resize_canvas.gif" alt="キャンバスサイズの調整" width="480">

黒いパネルの左右にあるハンドルをドラッグして、混色キャンバスの幅を調整できます（480–2000px）。

---

## デュアル混色エンジン —— MB / KM

左上の **MB/KM** ボタンでいつでも切り替え可能。キャンバスはストローク履歴から自動再描画されます。

- **Mixbox (MB)** —— デフォルト。[Mixbox](https://scrtwpns.com/mixbox/) の LUT ベースアルゴリズム、CC BY-NC 4.0。手動チューニングされたアンカー顔料 → 表現力が高く、色が「映える」（深紅+白で鮮やかなピンク/マゼンタへ）。同じ濃度ならカバー力が強い。
- **KM** —— 独自実装。32³ LUT で RGB を 38 波長の反射率スペクトル（[spectral.js](https://github.com/rvanwijnen/spectral.js) MIT ライセンスのデータ）にマッピングし、スペクトル空間で Kubelka-Munk 公式を適用。GPL v3。アンカー近似なし → 希釈時の色相が安定（深紅は薄めても赤、茶色は薄塗りでも茶）。混色がよりグラデーショナルで、移行帯が広く柔らかい。

どちらが「正しい」というわけではありません —— 表現力重視なら MB、色相の予測可能性と水彩の薄塗り感なら KM。違いは 25–75% の濃度範囲と複合色で最も顕著です。

[KM Tuner](https://food211.github.io/Mixbox-Palette/km-tuner.html) で両エンジンを並べて比較できます。

---

## 主な機能

- **4 つのプロフェッショナルパレット** —— Winsor & Newton Cotman、Schmincke Horadam、**呉竹 顔彩 (Kuretake Gansai)**、Digital Artist
- **6 種類のブラシプリセット** —— Circle / Soft / Watercolor / Splatter / Flat / Dry。ブラシとスマッジは前回のプリセットを個別に記憶
- **右クリック描画** —— 右クリックドラッグで背景色を使って描画
- **スポイト** —— `Alt + 左/右クリック` で前景色/背景色をピック
- **Photoshop へ転送** —— 混色キャンバスの選択範囲を Photoshop のアクティブレイヤーへ直接転送
- **双方向カラー同期** —— プラグイン ↔ Photoshop（カラーピッカー、スウォッチ、X キー入れ替え、D キーリセットすべて連動）
- **ズーム** —— 右上のドロップダウンで 60%–150%
- **アンドゥ/リドゥ** —— 最大 50 ステップ、GPU バッキングのキャンバススナップショット
- **自動保存** —— キャンバス、設定、履歴がすべて自動保存
- **多言語対応** —— English / 中文 / **日本語**（システム言語を自動判定、手動切り替えも可能）

---

## インストール

### Adobe Marketplace から
1. [MixBox Watercolor Palette on Adobe Marketplace](https://exchange.adobe.com/apps/cc/cc9344fb/mixbox-watercolor-palette) にアクセス
2. インストール後、Photoshop の `プラグイン` メニューから起動

### Release (.ccx) から
1. [Releases](https://github.com/food211/Mixbox-Palette/releases) から最新の `.ccx` ファイルをダウンロード
2. `.ccx` ファイルをダブルクリックしてインストール
3. Photoshop の `プラグイン` メニューから起動

### 開発者モード
1. このリポジトリをクローン
2. Adobe UXP Developer Tool を開く
3. `uxp-host/` ディレクトリをロード（ルートディレクトリではありません）
4. Photoshop の `プラグイン` メニューから起動

## 使い方

1. **パレットを選ぶ** —— 「Palette」ボタンをクリックして絵具のブランドを切り替え
2. **色をピック** —— スウォッチをクリックして前景色に設定
3. **混色** —— 混色キャンバス上で描画して色を混ぜる
4. **Photoshop で使う** —— 選択した色は自動的に Photoshop に同期。Photoshop 側の色変更も逆方向に同期されます

### Photoshop へピクセルを転送
1. Photoshop キャンバス上で選択範囲を作成
2. プラグイン側で矩形選択ツールに切り替え
3. 混色キャンバス上で範囲を描画 —— 選択ピクセルがアクティブレイヤーへ転送されます

## ショートカット

| キー | 機能 |
|------|------|
| `B` | ブラシツール |
| `S` | スマッジツール |
| `I` | スポイトツール |
| `X` | 前景色/背景色を入れ替え |
| `Shift`（押下中）| 一時的にスマッジツール |
| `Alt`（押下中）| 一時的にスポイト |
| `Alt + 左クリック` | 前景色をピック |
| `Alt + 右クリック` | 背景色をピック |
| `右クリック`（ドラッグ）| 背景色で描画 |
| `Esc` | 矩形選択を解除 |

## ライセンス

本プロジェクトには 2 種類のライセンスのコードが含まれます：

- **オリジナルコード**（KM エンジン、UI など）— [GPL-3.0](LICENSE)
- **Mixbox ライブラリ**（`js/mixbox.js`）— [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（非商用限定、Secret Weapons 提供）

Mixbox エンジンを使用する場合、全体に CC BY-NC 4.0 の制限が適用されます。KM エンジンには制限はありません。

## 商標について

Adobe および Photoshop は、Adobe の米国およびその他の国における登録商標または商標です。

## 更新履歴

[Changelog](https://food211.github.io/Mixbox-Palette/changelog.html) で過去のバージョン履歴を確認できます。

## サポート

- ⭐ プロジェクトに Star をつける
- 💬 [Discord コミュニティに参加](https://discord.gg/d3ubWGpe) — バグ報告、フィードバック、雑談
- 🐛 [バグ報告](https://github.com/food211/Mixbox-Palette/issues)
- 💡 機能の提案
- ☕ オープンソース活動を支援する: Alipay food211@qq.com / WeChat 172660507

---

> 日本のユーザーの皆さんへ：日本のユーザーが想像以上に深く使ってくれていることがわかり、日本語の README を用意しました。UI はすでに日本語対応済みです。翻訳の改善案やバグ報告、機能リクエストは Discord または GitHub Issues までお気軽にどうぞ。
