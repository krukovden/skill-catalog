#!/bin/sh
# safe-ssh — run a command on an APPROVED host alias, credential-free.
#
# Usage: safe-ssh.sh <alias> [-- command...]
#
# The only thing this script accepts as a target is a bare alias that a human has
# put in the allowlist. It never takes a hostname, IP, user, or key — those live
# in ~/.ssh/config. It always uses BatchMode so a missing key fails fast instead
# of hanging on a password prompt.
set -eu

ALLOWLIST="${SAFE_SSH_ALLOWLIST:-$HOME/.ssh/claude-allowed-hosts}"

usage() { echo "usage: safe-ssh.sh <alias> [-- command...]" >&2; exit 2; }

[ "$#" -ge 1 ] || usage
ALIAS="$1"; shift

# Drop an optional leading "--" separator before the remote command.
[ "${1:-}" = "--" ] && shift || true

# The target must be a bare alias token. Reject anything that looks like an option
# (-o ProxyCommand=...), a path, or contains whitespace — that blocks attempts to
# smuggle a real host or ssh option in through the "alias" argument.
case "$ALIAS" in
  -* | */* | *' '* | *"$(printf '\t')"*)
    echo "refused: '$ALIAS' is not a bare host alias" >&2
    exit 1
    ;;
esac

if [ ! -f "$ALLOWLIST" ]; then
  echo "refused: allowlist '$ALLOWLIST' not found." >&2
  echo "A human must create it (run setup-host.sh). Do not work around this." >&2
  exit 1
fi

# Exact whole-line match, so '#' comments and blank lines are naturally ignored.
if ! grep -qxF "$ALIAS" "$ALLOWLIST"; then
  echo "refused: '$ALIAS' is not in the approved allowlist ('$ALLOWLIST')." >&2
  echo "A human must add it deliberately. Do not work around this." >&2
  exit 1
fi

exec ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  -o StrictHostKeyChecking=accept-new \
  -o IdentitiesOnly=yes \
  -o PreferredAuthentications=publickey \
  -o ClearAllForwardings=yes \
  -- "$ALIAS" "$@"
