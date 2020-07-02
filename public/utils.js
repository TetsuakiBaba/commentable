function downloadAllComments() {
    // テキストエリアより文字列を取得
    const txt = document.getElementById('textarea_comment_history').value;
    if (!txt) { return; }

    // 文字列をBlob化
    const blob = new Blob([txt], { type: 'text/plain' });

    // ダウンロード用のaタグ生成
    const a = document.createElement('a');
    a.href =  URL.createObjectURL(blob);
    a.download = ('comments.txt');
    a.click();
  };

  class Flash{
    constructor(){
      this.alpha = 0;
      this.status = false;    
    }
    do(){
      this.status = true;
      this.alpha = 100;
    }
    draw(){
      if( this.status ){
        noStroke();
        fill(255, this.alpha);
        rect(0,0,width,height);
        this.alpha = this.alpha/10.0;
        if( this.alpha < 1.0 ){
          this.status = false;
        }
      }
    }
  }