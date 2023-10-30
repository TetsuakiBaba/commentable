<p align="center">
  <img src="./icons/commentable.app.logo.png" width="25%"/>
</p>

# Getting Started
とにかくCommentableを利用するだけ，という方は以下のページを参照してください．
  * https://commentable.carrd.co/

なお、@chihiros 氏によってcommentSreenっぽく表示形式が変更された commentable もよろしければお試しください。
  * https://github.com/chihiros/commentable-managed

# Compatibility
  * 配信者 commentable-desktop
    * [x] macOS
    * [x] Windows
    * [ ] Linux
  * 視聴者 webpage
    * Chrome
    * Firefox
    * Safari
    * Edge

# Installation

## Server
local環境での実行手順を示します。デプロイするときはデプロイ先の指示に従ってください。

```
$ git clone https://github.com/TetsuakiBaba/commentable.git
$ cd commentable
$ npm install
$ node server.js
open http://localhost on Chrome/Firefox browser for viewer mode
open http://localhost/broadcast.html on Chrome/Firefox browser for broadcasting mode
```

## Desktop Application
配信者はデスクトップアプリケーションである commentable-desktop を利用することで、コメントを自身のデスクトップ上に表示することができます。ビルドしたアプリケーションは以下からダウンロードできます。
  * https://github.com/TetsuakiBaba/commentable/releases

公式ページ (https://commentable.carrd.co/) には最新版のダウンロードリンクが貼られています。

# Author
  * Tetsuaki Baba
    * Tokyo Metropolitan University
    * https://tetsuakibaba.jp

# License
一部の音声ファイルを除き、Commentableは MIT ライセンスにて配布しています。