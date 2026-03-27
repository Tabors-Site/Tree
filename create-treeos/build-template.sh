#!/bin/bash
# Build the template/ directory from the current land/ source.
# Run this before `npm publish` to package the latest land server.
#
# Usage: cd create-treeos && bash build-template.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAND_DIR="$(cd "$SCRIPT_DIR/../land" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/template"

echo "Building template from $LAND_DIR..."

# Clean previous template
rm -rf "$TEMPLATE_DIR"
mkdir -p "$TEMPLATE_DIR"

# Copy land server files (excluding runtime artifacts)
rsync -a \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.land' \
  --exclude='uploads' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  "$LAND_DIR/" "$TEMPLATE_DIR/"

# Remove any leftover .env files in extensions
find "$TEMPLATE_DIR" -name ".env" -delete
find "$TEMPLATE_DIR" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true

echo "Template built at $TEMPLATE_DIR"
echo "Files: $(find "$TEMPLATE_DIR" -type f | wc -l)"
echo ""
echo "To publish:"
echo "  cd $SCRIPT_DIR"
echo "  npm publish"
