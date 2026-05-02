{
  description = "Office Hell — Touhou-style bullet hell HTML5 game";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = nixpkgs.lib.genAttrs systems;
      pkgsFor = forAll (system: import nixpkgs { inherit system; });
    in {
      devShells = forAll (system: {
        default = pkgsFor.${system}.mkShell {
          packages = with pkgsFor.${system}; [
            nodejs_22
          ];
        };
      });
    };
}
