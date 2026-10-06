{
  "targets": [
    {
      "target_name": "person_segmentation",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/person_segmentation.mm"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CFLAGS": ["-arch x86_64", "-arch arm64"],
            "OTHER_CPLUSPLUSFLAGS": ["-arch x86_64", "-arch arm64"],
            "OTHER_LDFLAGS": ["-arch x86_64", "-arch arm64"]
          },
          "link_settings": {
            "libraries": [
              "-framework Foundation",
              "-framework CoreVideo",
              "-framework Vision"
            ]
          }
        }]
      ]
    }
  ]
}
