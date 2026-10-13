{
  "targets": [
    {
      "target_name": "opus",
      "sources": [
        "src/node-opus.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(opus_include_dir)"
      ],
      "libraries": [
        "<(opus_library)",
        "-lm"
      ],
      "defines": [
        "NAPI_VERSION=3",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-O3"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      },
      "conditions": [
        [
          "OS==\"linux\"",
          {
            "ldflags": [
              "-static-libstdc++",
              "-static-libgcc"
            ]
          }
        ]
      ]
    }
  ]
}
