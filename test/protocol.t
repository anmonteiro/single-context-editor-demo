  $ mkdir project
  $ cp ../dune-project ../dune-workspace project/
  $ cp -RL ../src project/
  $ dune build --root project @all

Shared files expose both complete configurations in deterministic order.

  $ node protocol_client.mjs plural project project/src/shared.ml
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_mixed_override:byte preprocess=pp_ocaml.sh
  mode=melange default=false kind=implementation counterpart=- stdlib=melange objects=editor_mode_mixed_override:melange preprocess=pp_melange.sh

Exact conditional sources do not inherit another mode through extensionless
fallback.

  $ node protocol_client.mjs plural project project/src/override.ml
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_mixed_override:byte preprocess=pp_ocaml.sh
  $ node protocol_client.mjs plural project project/src/override.melange.ml
  mode=melange default=false kind=implementation counterpart=- stdlib=melange objects=editor_mode_mixed_override:melange preprocess=pp_melange.sh

Mode-specific module sets classify shared and exclusive files independently.

  $ node protocol_client.mjs plural project project/src/common.ml
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_narrowed_modules:byte preprocess=-
  mode=melange default=false kind=implementation counterpart=- stdlib=melange objects=editor_mode_narrowed_modules:melange preprocess=-
  $ node protocol_client.mjs plural project project/src/ocaml_extra.ml
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_narrowed_modules:byte preprocess=-
  $ node protocol_client.mjs plural project project/src/melange_extra.ml
  mode=melange default=false kind=implementation counterpart=- stdlib=melange objects=editor_mode_narrowed_modules:melange preprocess=-

Every mode reports its exact existing authored counterpart.

  $ node protocol_client.mjs plural project project/src/paired.ml
  mode=ocaml default=true kind=implementation counterpart=src/paired.mli stdlib=ocaml objects=editor_mode_mixed_override:byte preprocess=pp_ocaml.sh
  mode=melange default=false kind=implementation counterpart=src/paired.melange.mli stdlib=melange objects=editor_mode_mixed_override:melange preprocess=pp_melange.sh
  $ node protocol_client.mjs plural project project/src/paired_intf.mli
  mode=ocaml default=true kind=interface counterpart=src/paired_intf.ml stdlib=ocaml objects=editor_mode_mixed_override:byte preprocess=pp_ocaml.sh
  mode=melange default=false kind=interface counterpart=src/paired_intf.melange.ml stdlib=melange objects=editor_mode_mixed_override:melange preprocess=pp_melange.sh

Mode-specific dependency and preprocessing inputs stay isolated.

  $ node protocol_client.mjs plural project project/src/dep_user.ml
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_conditional_deps:byte,editor_mode_native_dep:byte preprocess=-
  $ node protocol_client.mjs plural project project/src/dep_user.melange.ml
  mode=melange default=false kind=implementation counterpart=- stdlib=melange objects=editor_mode_conditional_deps:melange,editor_mode_melange_dep:melange preprocess=-
  $ node protocol_client.mjs plural project project/src/reason_ppx_user.re
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_reason_ppx_override:byte preprocess=pp_reason.sh
  mode=melange default=false kind=implementation counterpart=- stdlib=melange objects=editor_mode_reason_ppx_override:melange preprocess=ppx

Singleton libraries remain nonempty and mark their sole configuration as the
group default, including Melange-only libraries.

  $ node protocol_client.mjs plural project project/src/ocaml_only.ml
  mode=ocaml default=true kind=implementation counterpart=- stdlib=ocaml objects=editor_mode_demo_ocaml_only:byte preprocess=-
  $ node protocol_client.mjs plural project project/src/melange_only.ml
  mode=melange default=true kind=implementation counterpart=- stdlib=melange objects=editor_mode_demo_melange_only:melange preprocess=-
  $ node protocol_client.mjs plural project project/src/file_only/melange_file_only.melange.ml
  mode=melange default=true kind=implementation counterpart=- stdlib=melange objects=editor_mode_melange_file_only:melange preprocess=-

The legacy request projects a shared file to OCaml and an exclusive file to
its only applicable configuration.

  $ node protocol_client.mjs legacy project project/src/shared.ml
  stdlib=ocaml objects=editor_mode_mixed_override:byte preprocess=pp_ocaml.sh
  $ node protocol_client.mjs legacy project project/src/melange_only.ml
  stdlib=melange objects=editor_mode_demo_melange_only:melange preprocess=-

A supported plural lookup failure remains a tagged error.

  $ node protocol_client.mjs plural project project/src/missing.ml
  error=No config found for file src/missing.ml. Try calling 'dune build'.
