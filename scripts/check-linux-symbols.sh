#!/bin/sh
set -eu
binary=prebuild/opus.node
readelf --version-info "$binary" > build-symbols.txt
if grep -Eo 'GLIBC_[0-9]+\.[0-9]+' build-symbols.txt | sed 's/GLIBC_//' | awk -F. '$1 > 2 || ($1 == 2 && $2 > 28) { bad = 1 } END { exit !bad }'; then
  echo 'Binary requires glibc newer than 2.28' >&2
  exit 1
fi
if readelf -d "$binary" | grep -E 'NEEDED.*(libstdc\+\+|libopus|libgcc_s)'; then
  echo 'Unexpected dynamic codec/C++ dependency' >&2
  exit 1
fi
rm build-symbols.txt
