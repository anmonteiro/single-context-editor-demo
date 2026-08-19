#!/bin/sh
case "$1" in
  *.mli)
    printf '%s\n' \
      'val preprocess_marker : string' \
      'val completion_common : int' \
      'val completion_melange : int'
    ;;
  *)
    printf '%s\n' \
      'let preprocess_marker = "melange"' \
      'let completion_common = 1' \
      'let completion_melange = 1'
    ;;
esac
printf '# 1 "%s"\n' "$1"
cat "$1"
