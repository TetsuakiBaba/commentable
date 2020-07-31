![](./public/assets/logo.png)

| <img src="./commentable_sample.gif" /> | 
|:--:|
|mmhmmのVritual カメラにコメントを載せたところ|



| <img src="./teaser.gif" /> | 
|:--:|
| broadcast機能を使って、お手軽配信しているところ。左がviewerページ、右が配信ページ  |

# Commentableとは
授業中に気軽に学生にコメントしてほしい。このシンプルな欲求から開発をスタートしました。
[commentscreen](https://commentscreen.com/ )が素晴らしく、たくさんインスパイアされました。ただ、、
  * OSBと連携したい（OBSのVirtual Cameraにコメントを載せたい）
  * mmhmmにコメント載せたい
  * 音声読み上げや、リアクション、授業に特化したコメント機能を手軽に追加（プロトタイピング）したい
  * ブラウザだけで動作して、なんならzoomとかなくても最悪配信できちゃいたい

といったcommentscreenでは簡単に実現できない個人的な希望を叶えるために、2020年のオンライン授業のために開発しました。東京都立大学のプロトタイピング基礎及びインタラクションデザイン演習実習Ⅰという授業にて、実際に本ソフトウェアを授業の過程で試作していき、前期授業終了に合わせ、最終的にここに公開することとしました。

# 動作環境
  * macOS, Windows, Linux上にて、ChromeまたはFirefoxにて動作。SafariやIEは非推奨

# Demo
以下はデモとして公開しているリンクですので、実際に利用する場合にはnode.jsが利用可能なサーバにデプロイしてご利用ください。以下ではherokuにデプロイしています。
## 単独での利用方法
下記リンクをそれぞれ ChromeまたはFirefoxで開いて、配信ページのスタートボタンを押すと、受信、コメントページに配信画像が表示されます。コメントした内容が同じ受信、コメントページを開いている他のユーザにも同時に閲覧できるようになります。ブラウザのみで全て完結しているので、非常に便利ですが、接続者数が20名を超えるような配信を行う場合は、次に示す他の配信アプリケーション（ZoomやMicrosoft Teams等）との併用にてご利用ください。WebRTCによるP2P接続にて各ユーザに映像を配信するため、どうしても配信側のPC負荷に限界があります。またP2P通信のため、利用するネットワーク環境によっては映像及び音声が受信できない場合があります。
  * 配信ページ：https://commentable-demo.herokuapp.com/broadcast.html
  * 受信、コメントページ：https://commentable-demo.herokuapp.com/

## 他の配信ツールとの併用
下記の受信、コメントページを開き、画面共有ボタンを押し、ブラウザ窓または、表示箇所を個別に配信に利用してください。配信者は受信、自身の画面キャプチャやカメラ画像の上にコメントが表示されるので、その内容をZoomやhangoutなどを利用して共有してください。
  * 受信、コメントページ：https://commentable-demo.herokuapp.com/

# Installation
local環境での実行手順を示します。デプロイするときはデプロイ先の指示に従ってください。

```
$ git clone https://github.com/TetsuakiBaba/commentable.git
$ cd commentable
$ npm install
$ node server.js
open http://localhost on Chrome/Firefox browser for viewer mode
open http://localhost/broadcast.html on Chrome/Firefox browser for broadcasting mode
```

# Technical Details
## broadcast.html について
WebRTCによるP2P接続を利用していますので、利用するネットワーク環境（特に組織内ローカルネット等）によってはいわゆるNAT超えができずに映像配信が行えない場合がありますので、ご注意ください。

## Limitation
javascriptを利用したキャンバス上にコメントが表示されますが、これらをNDIやVritual Camera等を通じて直接他の配信ツールに映像を渡すことが現状では実装できていません。broadcast機能を利用して直接配信する分には問題はありませんが、多人数（殆どがこのケースでの利用かなと思います）の場合は他の配信ツールを利用してこのキャンバスをどうにかして配信することになると思います。Zoomの場合は画面の領域を直接キャプチャできる機能があるので、それをお使いください。

# Contribution
本プロジェクトをサポートしてくれる方、いらっしゃればご連絡いただけると幸いです。謝礼も検討できます。欲しい機能は次のとおりです。
  - js canvasイメージのNDI送信
  - リファクタリング
  - 自動翻訳機能の実装

# Requirement
  - node.js: https://nodejs.org/en/
  - p5.js( revised by Tetsuaki Baba ): https://p5js.org
  - p5.sound.js: 
  - WebRTC: https://developer.mozilla.org/ja/docs/Web/API/WebRTC_API
  - speechSynthesis: https://developer.mozilla.org/ja/docs/Web/API/Window/speechSynthesis



# Author
  * Tetsuaki Baba
    * Tokyo Metropolitan University
    * https://tetsuakibaba.jp

# License
一部の音声ファイルを除き、Commentableは MIT ライセンスにて配布しています。