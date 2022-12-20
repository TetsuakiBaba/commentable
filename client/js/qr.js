// QRコードを生成する関数
function toggleQR(checked, position, room) {
  let qr_width;
  let qr_height;
  let qr_font_size;
  console.log(windowWidth, windowHeight);

  if (position == "none") {
    document.getElementById("QR_center").innerHTML = "";
    document.getElementById("QR_top_right").innerHTML = "";
    document.getElementById("QR_center").hidden = true;
    document.getElementById("QR_top_right").hidden = true;
    return;
  }
  else if (position == "center") {
    qr_width = qr_height = windowWidth / 3;
    qr_font_size = windowWidth / 150;
  }
  else if (position == "top_right") {
    qr_width = qr_height = windowWidth / 10;
    qr_font_size = windowWidth / 150;
  }
  const qrCode = new QRCodeStyling({
    "width": qr_width,
    "height": qr_height,
    "data": hostname+"/?room="+encodeURI(room),
    "margin": qr_width / 15,
    "qrOptions": { "typeNumber": "0", "mode": "Byte", "errorCorrectionLevel": "Q" },
    "imageOptions": { "hideBackgroundDots": true, "imageSize": 0.4, "margin": 0 },
    "dotsOptions": { "type": "dots", "color": "#333333" },
    "backgroundOptions": { "color": "#ffffff" },
    "image": './images/commentable_logo_text.png',
    "dotsOptionsHelper": {
      "colorType": { "single": true, "gradient": false },
      "gradient": { "linear": true, "radial": false, "color1": "#6a1a4c", "color2": "#6a1a4c", "rotation": "0" }
    },
    "cornersSquareOptions": { "type": "dot", "color": "#333333" },
    "cornersSquareOptionsHelper": {
      "colorType": { "single": true, "gradient": false },
      "gradient": { "linear": true, "radial": false, "color1": "#333333", "color2": "#333333", "rotation": "0" }
    },
    "cornersDotOptions": { "type": "dot", "color": "#333333" },
    "cornersDotOptionsHelper": {
      "colorType": { "single": true, "gradient": false },
      "gradient": { "linear": true, "radial": false, "color1": "#333333", "color2": "#333333", "rotation": "0" }
    },
    "backgroundOptionsHelper": {
      "colorType": { "single": true, "gradient": false },
      "gradient": { "linear": true, "radial": false, "color1": "#ffffff", "color2": "#ffffff", "rotation": "0" }
    }
  });

  if (checked && position == "center") {
    document.getElementById("QR_center").innerHTML = "";
    document.getElementById("QR_top_right").innerHTML = "";
    qrCode.append(document.getElementById("QR_center"));
    document.getElementById("QR_center").hidden = false;
    document.getElementById("QR_top_right").hidden = true;
  }
  else if (checked && position == "top_right") {
    document.getElementById("QR_center").innerHTML = "";
    document.getElementById("QR_top_right").innerHTML = "";

    qrCode.append(document.getElementById("QR_top_right"));
    document.getElementById("QR_top_right").hidden = false;
    document.getElementById("QR_center").hidden = true;
  }
  else if (!checked && position == "center") {
    document.getElementById("QR_center").innerHTML = "";
    document.getElementById("QR_top_right").innerHTML = "";

    document.getElementById("QR_center").innerHTML = "";
    document.getElementById("QR_center").hidden = true;
    document.getElementById("QR_top_right").hidden = false;
  }
  else if (!checked && position == "top_right") {
    document.getElementById("QR_center").innerHTML = "";
    document.getElementById("QR_top_right").innerHTML = "";

    document.getElementById("QR_top_right").hidden = true;
    document.getElementById("QR_center").hidden = false;
  }
}
