  $ mkdir project
  $ cp ../dune-project ../dune-workspace project/
  $ cp -RL ../src project/
  $ dune build --root project @all

ocaml-lsp sees the same filtered configuration sets as Dune.

  $ node lsp_client.mjs project configurations project/src/shared.ml
  mode=ocaml default=true
  mode=melange default=false
  $ node lsp_client.mjs project configurations project/src/override.ml
  mode=ocaml default=true
  $ node lsp_client.mjs project configurations project/src/override.melange.ml
  mode=melange default=false

Definitions from a shared source fan out to both authored conditional sources.

  $ node lsp_client.mjs project definition project/src/shared.ml 0 26
  src/override.melange.ml:0:4
  src/override.ml:0:4

Returned locations canonicalize a symlinked document to authored files.

  $ ln -s shared.ml project/src/shared_link.ml
  $ node lsp_client.mjs project definition project/src/shared_link.ml 0 26
  src/override.melange.ml:0:4
  src/override.ml:0:4

An exclusive conditional source executes only its Melange configuration.

  $ node lsp_client.mjs project definition project/src/dep_user.melange.ml 0 50
  src/melange_dep.ml:0:4

Alternating the two Merlin configurations preserves their distinct inferred
types in hover and document symbols.

  $ node lsp_client.mjs project hover project/src/shared.ml 1 8
  OCaml: int
  Melange: string
  $ node lsp_client.mjs project symbols project/src/shared.ml mode_value
  mode_value: OCaml: int | Melange: string

Completion is the portable intersection of the two preprocessed scopes.

  $ node lsp_client.mjs project completion project/src/shared.ml
  completion_common: int

Diagnostics deduplicate universal failures and retain exact mode provenance for
mode-specific failures.

  $ node lsp_client.mjs project diagnostic-mode project/src/shared.ml
  source=ocamllsp (Melange) modes=melange target=completion_ocaml
  $ node lsp_client.mjs project diagnostic-shared project/src/shared.ml
  source=ocamllsp modes=ocaml,melange target=completion_missing

Counterpart navigation unions exact targets by mode in both directions.

  $ node lsp_client.mjs project switch project/src/paired.ml
  src/paired.melange.mli
  src/paired.mli
  $ node lsp_client.mjs project switch project/src/paired_intf.mli
  src/paired_intf.melange.ml
  src/paired_intf.ml

Rename is returned only after both modes produce the same workspace edit.

  $ node lsp_client.mjs project rename project/src/shared.ml 0 6 renamed
  edits=2
