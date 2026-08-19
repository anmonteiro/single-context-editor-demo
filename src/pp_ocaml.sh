#!/bin/sh
case "$1" in
  *.mli)
    printf '%s\n' \
      'val preprocess_marker : int' \
      'val completion_common : int' \
      'val completion_ocaml : int'
    ;;
  *)
    printf '%s\n' \
      'let preprocess_marker = 42' \
      'let completion_common = 1' \
      'let completion_ocaml = 1'
    ;;
esac
printf '# 1 "%s"\n' "$1"
cat "$1"
