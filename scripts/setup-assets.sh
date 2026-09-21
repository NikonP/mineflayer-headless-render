#!/usr/bin/env bash
#
# Fetches the Bedrock asset pack used for entity models and textures.
#
# bedrock-samples is (c) Mojang AB and is NOT covered by this repository's MIT
# licence — this script only downloads it to your machine, it is never bundled.
#
# Usage:
#   scripts/setup-assets.sh [destination]
#
# Default destination: ./bedrock-samples (the path the renderer looks for, unless
# BEDROCK_SAMPLES_PATH is set).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$ROOT/bedrock-samples}"
URL="https://github.com/Mojang/bedrock-samples.git"
REF="v1.21.50.7"

PATHS=(
  resource_pack/entity
  resource_pack/materials
  # models/ as a whole, not just models/entity: mobs.json holds the shared
  # geometries (player, iron golem, skull, agent, bed) that entity defs point at.
  resource_pack/models
  resource_pack/render_controllers
  resource_pack/textures/entity
)

if [ -e "$DEST/.git" ]; then
  echo "using existing checkout at $DEST"
else
  echo "cloning bedrock-samples ($REF, sparse + partial)..."
  git clone --filter=blob:none --no-checkout --branch "$REF" --depth 1 "$URL" "$DEST"
fi

cd "$DEST"
git sparse-checkout init --no-cone
git sparse-checkout set "${PATHS[@]}"
git checkout "$REF"
echo "bedrock-samples ready: $DEST ($(git describe --tags))"
