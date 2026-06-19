#!/bin/sh
# setup-host — one-time, HUMAN-run setup for credential-free SSH to one host.
#
# A human runs this, not the AI agent: it involves the key passphrase and the real
# address of the host, which must never pass through the agent. It:
#   1. generates an ed25519 key WITH a passphrase (if you don't already have one),
#   2. loads it into ssh-agent,
#   3. writes a `Host <alias>` block to ~/.ssh/config,
#   4. adds <alias> to the allowlist (~/.ssh/claude-allowed-hosts),
#   5. prints the public key for you to install on the host.
#
# Usage: setup-host.sh
set -eu

SSH_DIR="$HOME/.ssh"
CONFIG="$SSH_DIR/config"
ALLOWLIST="${SAFE_SSH_ALLOWLIST:-$SSH_DIR/claude-allowed-hosts}"

mkdir -p "$SSH_DIR"; chmod 700 "$SSH_DIR"

printf 'Alias to use (what you and the agent will type, e.g. plcsim-lab): '
read -r ALIAS
[ -n "$ALIAS" ] || { echo "alias is required" >&2; exit 1; }
case "$ALIAS" in -*|*/*|*' '*) echo "alias must be a bare token (no spaces, slashes, leading -)" >&2; exit 1;; esac

printf 'Real hostname or IP of the host (stays in ~/.ssh/config, never shown to the agent): '
read -r HOSTNAME
[ -n "$HOSTNAME" ] || { echo "hostname is required" >&2; exit 1; }

printf 'Login user on the host: '
read -r USER_ON_HOST
[ -n "$USER_ON_HOST" ] || { echo "user is required" >&2; exit 1; }

printf 'SSH port [22]: '
read -r PORT
PORT="${PORT:-22}"

KEYFILE="$SSH_DIR/id_ed25519_${ALIAS}"
if [ -f "$KEYFILE" ]; then
  echo "Key $KEYFILE already exists — reusing it."
else
  echo "Generating an ed25519 key WITH a passphrase. Choose a strong passphrase when prompted."
  ssh-keygen -t ed25519 -f "$KEYFILE" -C "claude-agent-${ALIAS}"
fi

# Load into ssh-agent (start one if needed).
if ! ssh-add -l >/dev/null 2>&1; then
  echo "Starting ssh-agent..."
  eval "$(ssh-agent -s)"
fi
ssh-add "$KEYFILE"

# Append a Host block if the alias is not already present.
touch "$CONFIG"; chmod 600 "$CONFIG"
if grep -qiE "^[[:space:]]*Host[[:space:]]+${ALIAS}([[:space:]]|$)" "$CONFIG"; then
  echo "A Host block for '$ALIAS' already exists in $CONFIG — leaving it unchanged."
else
  cat >> "$CONFIG" <<EOF

Host ${ALIAS}
    HostName ${HOSTNAME}
    User ${USER_ON_HOST}
    Port ${PORT}
    IdentityFile ${KEYFILE}
    IdentitiesOnly yes
    AddKeysToAgent yes
    ForwardAgent no
    StrictHostKeyChecking accept-new
EOF
  echo "Added Host block for '$ALIAS' to $CONFIG"
fi

# Add to the allowlist (this is the deliberate act of authorization).
touch "$ALLOWLIST"; chmod 600 "$ALLOWLIST"
if grep -qxF "$ALIAS" "$ALLOWLIST"; then
  echo "'$ALIAS' is already in the allowlist."
else
  echo "$ALIAS" >> "$ALLOWLIST"
  echo "Authorized '$ALIAS' in $ALLOWLIST"
fi

echo
echo "Install this PUBLIC key on the host (append to ~/.ssh/authorized_keys for ${USER_ON_HOST}):"
echo "----------------------------------------------------------------------"
cat "${KEYFILE}.pub"
echo "----------------------------------------------------------------------"
echo
echo "Then verify with:  scripts/check-setup.sh ${ALIAS}"
