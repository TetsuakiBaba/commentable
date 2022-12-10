function downloadAllComments() {
  // テキストエリアより文字列を取得
  const txt = document.getElementById('textarea_comment_history').value;
  if (!txt) { return; }

  // 文字列をBlob化
  const blob = new Blob([txt], { type: 'text/plain' });

  // ダウンロード用のaタグ生成
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ('comments.txt');
  a.click();
};
