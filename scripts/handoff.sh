#!/bin/bash
# Package the Pulse secrets that CANNOT live in git into one encrypted archive.
#
# This script is safe to commit: it contains no secrets, it only collects them.
# What it collects IS sensitive — live API keys and MCP bearer tokens — so the
# output never goes near git, email or chat.
#
# Run on the OLD machine:
#
#   bash scripts/handoff.sh
#
# It prompts for a passphrase and writes one .zip to your Desktop. Move it by a
# channel you trust (AirDrop, encrypted USB, a password manager's file
# attachment), and send the passphrase separately.
#
# On the NEW machine:
#   unzip pulse-handoff-<date>.zip      # prompts for the same passphrase
#   bash RESTORE.sh /path/to/pulse      # included in the archive
#
# Delete the archive from both machines once the new one works.
set -euo pipefail

REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OUT="$HOME/Desktop/pulse-handoff-$(date +%Y%m%d).zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

say() { printf '  %s\n' "$1"; }

echo "Pulse handoff — packaging secrets from: $REPO"
echo

# ---- 1. env files (gitignored; hold the real keys) ----
mkdir -p "$STAGE/env"
for f in "apps/cms/.env" "apps/web/.env.local"; do
  if [ -f "$REPO/$f" ]; then
    mkdir -p "$STAGE/env/$(dirname "$f")"
    cp "$REPO/$f" "$STAGE/env/$f"
    say "+ $f"
  else
    say "- $f (missing, skipped)"
  fi
done

# ---- 2. the MCP shim (outside the repo — the easiest thing to forget) ----
if [ -d "$HOME/.config/mcp" ]; then
  mkdir -p "$STAGE/config"
  cp -R "$HOME/.config/mcp" "$STAGE/config/mcp"
  say "+ ~/.config/mcp/ ($(ls -1 "$HOME/.config/mcp" | wc -l | tr -d ' ') files, incl. tokens.env)"
else
  say "- ~/.config/mcp (not found, skipped)"
fi

# ---- 3. optional snapshot of local data ----
if [ -f "$REPO/seed-data.tar.gz" ]; then
  cp "$REPO/seed-data.tar.gz" "$STAGE/"
  say "+ seed-data.tar.gz (local DB snapshot)"
else
  say "- seed-data.tar.gz (none; run 'npm run db:export' first if you want local data)"
fi

# ---- 4. restore script, written into the archive ----
cat > "$STAGE/RESTORE.sh" <<'RESTORE'
#!/bin/bash
# Run from inside the unzipped folder, on the NEW machine.
set -euo pipefail
REPO="${1:-$HOME/work/pulse}"

[ -d "$REPO" ] || { echo "No repo at $REPO — git clone it first, then: bash RESTORE.sh /path/to/pulse"; exit 1; }

echo "Restoring into: $REPO"

for f in "apps/cms/.env" "apps/web/.env.local"; do
  if [ -f "env/$f" ]; then
    if [ -f "$REPO/$f" ]; then
      cp "$REPO/$f" "$REPO/$f.before-restore"
      echo "  ! $f existed — backed up to $f.before-restore"
    fi
    mkdir -p "$REPO/$(dirname "$f")"
    cp "env/$f" "$REPO/$f"
    echo "  + $f"
  fi
done

if [ -d "config/mcp" ]; then
  mkdir -p "$HOME/.config"
  [ -d "$HOME/.config/mcp" ] && mv "$HOME/.config/mcp" "$HOME/.config/mcp.before-restore"
  cp -R "config/mcp" "$HOME/.config/mcp"
  chmod 700 "$HOME/.config/mcp"
  chmod 600 "$HOME/.config/mcp/tokens.env" 2>/dev/null || true
  chmod +x "$HOME/.config/mcp"/*.sh 2>/dev/null || true
  echo "  + ~/.config/mcp/ (permissions reset to 700/600)"
  echo
  echo "  ACTION NEEDED: ~/.config/mcp/remote.sh hardcodes an nvm Node path."
  grep -n '^PATH=' "$HOME/.config/mcp/remote.sh" 2>/dev/null | sed 's/^/    current: /' || true
  echo "    this machine's node: $(command -v node || echo '<node not found>')"
fi

[ -f seed-data.tar.gz ] && cp seed-data.tar.gz "$REPO/" && echo "  + seed-data.tar.gz (restore with: npm run db:import)"

cat <<'NEXT'

Next on the new machine:
  cd <repo> && npm run setup       # installs workspaces; SKIPS the .env files just restored
  npm run dev                      # Strapi :1338, Next :3000

Regenerate these in apps/cms/.env — do NOT reuse across machines:
  for k in APP_KEYS API_TOKEN_SALT ADMIN_JWT_SECRET TRANSFER_TOKEN_SALT; do
    echo "$k=$(openssl rand -base64 32)"
  done

Keep JWT_SECRET and ENCRYPTION_KEY as-is ONLY if you also restored the database.
JWT_SECRET invalidates sessions; ENCRYPTION_KEY must match whatever encrypted
the stored data.

Full instructions: docs/machine-setup.md
NEXT
RESTORE
chmod +x "$STAGE/RESTORE.sh"
say "+ RESTORE.sh"

echo
echo "Encrypting. Use a strong passphrase — this archive holds live API keys."
echo "Send the passphrase separately from the file."
echo
( cd "$STAGE" && zip -er -q "$OUT" . )

echo
echo "Done: $OUT  ($(du -h "$OUT" | cut -f1))"
echo "Delete it from both machines once the new one is working."
