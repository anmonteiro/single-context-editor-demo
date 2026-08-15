{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    ocaml-overlays = {
      url = "github:nix-ocaml/nix-overlays";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    dune = {
      url = "github:anmonteiro/dune/anmonteiro/editor-mode-prototype";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    merlin = {
      url = "github:anmonteiro/merlin/anmonteiro/editor-mode-prototype";
      flake = false;
    };

    ocaml-lsp = {
      url = "github:anmonteiro/ocaml-lsp/anmonteiro/editor-mode-prototype";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.merlin.follows = "merlin";
    };

    melange = {
      url = "github:melange-re/melange/v7-55";
      inputs.nixpkgs.follows = "ocaml-overlays";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      ocaml-overlays,
      ...
    }:
    let
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system:
          let
            pkgs = nixpkgs.legacyPackages.${system}.appendOverlays [
              ocaml-overlays.overlays.default
            ];
          in
          f system pkgs
        );
    in
    {
      formatter = forAllSystems (_system: pkgs: pkgs.nixfmt);

      devShells = forAllSystems (
        system: pkgs:
        let
          ocamlPackages = pkgs.ocaml-ng.ocamlPackages_5_5;
          dune = inputs.dune.packages.${system}.default;
          melange = inputs.melange.packages.${system}.default;
          ocaml-lsp = inputs.ocaml-lsp.packages.${system}.default;
          ocaml-index = inputs.ocaml-lsp.packages.${system}.ocaml-index;
          merlin = ocamlPackages.merlin.overrideAttrs (_: {
            src = inputs.merlin;
          });
        in
        {
          default = pkgs.mkShell {
            packages = [
              dune
              melange
              merlin
              ocaml-lsp
              ocaml-index
              ocamlPackages.ocaml
              ocamlPackages.findlib
              ocamlPackages.reason
              pkgs.ocamlformat_0_29_0
              pkgs.nodejs
            ];
          };
        }
      );
    };
}
