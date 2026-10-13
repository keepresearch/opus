#!/bin/sh
set -eu
if [ "${OPUS_TARGET##*-}" = musl ]; then
  apk add --no-cache cmake python3 make g++ git curl
else
  export PATH=/opt/rh/gcc-toolset-14/root/usr/bin:$PATH
  if ! command -v cmake >/dev/null; then python3 -m pip install cmake; fi
  curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o /tmp/node-shasums
  OPUS_NODE_ARCHIVE=$(awk -v arch="$OPUS_ARCH" '$2 ~ ("linux-" arch ".tar.xz$") { print $2 }' /tmp/node-shasums)
  test -n "$OPUS_NODE_ARCHIVE"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$OPUS_NODE_ARCHIVE" -o "/tmp/$OPUS_NODE_ARCHIVE"
  (cd /tmp && grep " $OPUS_NODE_ARCHIVE$" node-shasums | sha256sum -c -)
  tar -xJf "/tmp/$OPUS_NODE_ARCHIVE" -C /opt
  export PATH="/opt/${OPUS_NODE_ARCHIVE%.tar.xz}/bin:$PATH"
fi
npm ci --ignore-scripts
npm run build:source
npm test
npm run typecheck
npm run lint
if [ "${OPUS_TARGET##*-}" = glibc ]; then sh scripts/check-linux-symbols.sh; fi
npm run package:binary
