#!/usr/bin/env bash
# Convert all video clips in clips/ to web-friendly H.264 mp4 in public/clips/
# Usage: bash scripts/convert-clips.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INPUT_DIR="$PROJECT_DIR/clips"
OUTPUT_DIR="$PROJECT_DIR/public/clips"

mkdir -p "$OUTPUT_DIR"

# Check for ffmpeg
if ! command -v ffmpeg &> /dev/null; then
  echo "Error: ffmpeg is not installed. Install it with: brew install ffmpeg"
  exit 1
fi

MANIFEST=()
COUNT=0
SKIPPED=0

echo "Converting clips from $INPUT_DIR → $OUTPUT_DIR"
echo "---"

# Collect all video files
FILES=()
for ext in MOV mov mp4 MP4; do
  for f in "$INPUT_DIR"/*."$ext"; do
    [ -f "$f" ] && FILES+=("$f")
  done
done

for file in "${FILES[@]}"; do
  basename="$(basename "$file")"
  # Sanitize filename: lowercase, spaces to underscores, force .mp4 extension
  sanitized="$(echo "${basename%.*}" | tr '[:upper:]' '[:lower:]' | tr ' ' '_').mp4"
  output="$OUTPUT_DIR/$sanitized"

  if [ -f "$output" ]; then
    echo "SKIP (exists): $sanitized"
    SKIPPED=$((SKIPPED + 1))
    MANIFEST+=("$sanitized")
    continue
  fi

  echo "CONVERT: $basename → $sanitized"
  ffmpeg -i "$file" \
    -c:v libx264 \
    -preset fast \
    -crf 23 \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    -an \
    -movflags +faststart \
    -y \
    "$output" \
    -loglevel warning

  MANIFEST+=("$sanitized")
  COUNT=$((COUNT + 1))
done

# Generate manifest.json
MANIFEST_FILE="$OUTPUT_DIR/manifest.json"
echo "[" > "$MANIFEST_FILE"
for i in "${!MANIFEST[@]}"; do
  if [ $i -lt $((${#MANIFEST[@]} - 1)) ]; then
    echo "  \"${MANIFEST[$i]}\"," >> "$MANIFEST_FILE"
  else
    echo "  \"${MANIFEST[$i]}\"" >> "$MANIFEST_FILE"
  fi
done
echo "]" >> "$MANIFEST_FILE"

echo "---"
echo "Done! Converted: $COUNT | Skipped: $SKIPPED | Total: ${#MANIFEST[@]}"
echo "Manifest: $MANIFEST_FILE"
