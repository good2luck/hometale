#!/bin/bash

# HomeTale prepublish script

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "========================================="
echo "  HomeTale - Preparing for publish"
echo "========================================="
echo ""

cd "$PROJECT_DIR"

# Clean previous builds
echo "→ Cleaning previous builds..."
rm -rf cli/dist
rm -rf server/dist
rm -rf web/dist

# Build web first (outputs to cli/dist/static)
echo ""
echo "→ Building web frontend..."
cd "$PROJECT_DIR/web"
npm run build

# Build server
echo ""
echo "→ Building server..."
cd "$PROJECT_DIR/server"
npm run build

# Build CLI first (creates dist dir)
echo ""
echo "→ Building CLI..."
cd "$PROJECT_DIR/cli"
npm run build

# Copy server build to cli/dist/server
echo ""
echo "→ Copying server to cli..."
cd "$PROJECT_DIR"
mkdir -p cli/dist/server
cp -r server/dist/* cli/dist/server/

# Copy static assets to cli/dist
echo ""
echo "→ Copying static assets to cli..."
mkdir -p cli/dist/static
cp -r server/static/* cli/dist/static/ 2>/dev/null || true

# Replace @hometale/server imports with relative paths in cli/dist
echo ""
echo "→ Rewriting @hometale/server imports..."
cd "$PROJECT_DIR"

# Depth 1 files (chat.js, config-wizard.js, etc.) -> ./server/index.js
find cli/dist -maxdepth 1 -name '*.js' -exec sed -i '' "s|from '@hometale/server'|from './server/index.js'|g" {} +
find cli/dist -maxdepth 1 -name '*.js' -exec sed -i '' 's|from "@hometale/server"|from "./server/index.js"|g' {} +

# Depth 2+ files (commands/*.js, etc.) -> ../server/index.js
find cli/dist -mindepth 2 -name '*.js' -exec sed -i '' "s|from '@hometale/server'|from '../server/index.js'|g" {} +
find cli/dist -mindepth 2 -name '*.js' -exec sed -i '' 's|from "@hometale/server"|from "../server/index.js"|g' {} +

echo ""
echo "========================================="
echo "  Build complete!"
echo "========================================="
echo ""
echo "To publish:"
echo "  cd cli"
echo "  npm publish --access=public"
echo ""
