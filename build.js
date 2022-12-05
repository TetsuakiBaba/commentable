const { build } = require('electron-builder');

build({
  config: {
    // package.json の 'name' と異なる名前をつける場合に必要
    // productName: 'Commentable',
    // 出力ファイル名, 例: Sample-0.0.1-win32-x64.exe
    artifactName: '${productName}-${version}-${platform}-${arch}.${ext}',
    copyright: 'Copyright (c) 2020 sprout2000',
    // パッケージ対象とするファイル
    files: ['./**/*'],
    // 出力先とアセットファイル置き場
    directories: {
      output: 'release',
      buildResources: 'assets',
    },
    publish: {
      // GitHub へデプロイする
      provider: 'github',
      // とりあえず draft としてデプロイ
      releaseType: 'release', // or 'release', 'prerelease'
    },
    // Windows 向け設定
    win: {
      // ICO ファイルが必要
      icon: 'assets/win32.ico',
      // ターゲット
      target: ['nsis', 'zip'],
      // Windows では 'publisherName' が必要
      publisherName: 'sprout2000',
    },
    // Windows インストーラの設定
    nsis: {
      // インストーラと分かる名前にする
      artifactName: '${productName}-${version}-win32-installer.exe',
    },
    mac: {
      // ICNS ファイルが必要
      icon: 'assets/mac.icns',
      /**
       * macOS では 'category' が必須
       * https://developer.apple.com/documentation/bundleresources/information_property_list/lsapplicationcategorytype
       */
      category: 'public.app-category.developer-tools',
      target: {
        // macOS では string 型のみ指定可, 配列は使えないことに注意
        target: 'dmg', // or 'default', 'zip'
        // Intel, Apple Silicon ともにビルド可能
        arch: ['x64', 'arm64'],
      },
      // コード署名しない場合は null の設定が必須
      identity: null,
    },
  },
});
