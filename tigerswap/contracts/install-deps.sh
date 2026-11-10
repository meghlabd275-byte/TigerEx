#!/usr/bin/env bash
#
# Install the Solidity dependencies pinned by this project.
#
# `lib/` is git-ignored (third-party code is not vendored into this repository),
# so a fresh checkout must fetch the exact revisions the test suite was verified
# against before `forge build` / `forge test` will run.
#
# The revisions below are the ones this repository's suite was last verified
# green with: OpenZeppelin is pinned to a tag whose `pragma` requirements are
# satisfiable by the project's `solc = 0.8.20`, so `lib/**` builds cleanly when
# it is not skipped.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p lib

clone_pinned() {
    local url="$1" dir="$2" ref="$3"
    if [ -d "$dir/.git" ]; then
        git -C "$dir" fetch --depth 1 origin "$ref"
    else
        git clone --filter=blob:none --no-checkout "$url" "$dir"
        git -C "$dir" fetch --depth 1 origin "$ref"
    fi
    git -C "$dir" checkout --detach FETCH_HEAD
}

clone_pinned https://github.com/foundry-rs/forge-std.git \
    lib/forge-std v1.9.4
clone_pinned https://github.com/OpenZeppelin/openzeppelin-contracts.git \
    lib/openzeppelin-contracts v5.0.2

echo "Solidity dependencies installed under lib/"
