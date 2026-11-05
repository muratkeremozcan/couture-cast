#!/usr/bin/env bash
set -u -o pipefail

install_command="${INSTALL_COMMAND:-npm ci}"
# Custom commands can include tests or other work; execute them once.
if [[ "$install_command" != "npm ci" && "$install_command" != "npm install" ]]; then
  exec bash --noprofile --norc -eo pipefail -c "$install_command"
fi

# Long enough to outlast a short burst of 5xx from a package's release host.
retry_delay="${INSTALL_RETRY_DELAY_SECONDS:-30}"
if [[ ! "$retry_delay" =~ ^[0-9]{1,2}$ ]] || (( 10#$retry_delay > 30 )); then
  echo "INSTALL_RETRY_DELAY_SECONDS must be an integer from 0 through 30." >&2
  exit 2
fi
retry_delay=$((10#$retry_delay))

install_log=$(mktemp) || exit 1
trap 'rm -f "$install_log"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for attempt in 1 2 3; do
  $install_command 2>&1 | tee "$install_log"
  statuses=("${PIPESTATUS[@]}")
  if (( statuses[1] != 0 )); then exit "${statuses[1]}"; fi
  if (( statuses[0] >= 128 )); then exit "${statuses[0]}"; fi
  if (( statuses[0] == 0 )); then exit 0; fi
  if (( attempt == 3 )) || ! grep -Eq '\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|EPIPE|ERR_SOCKET_TIMEOUT|ENOTFOUND|E50[0234]|Z_DATA_ERROR)\b|\b50[0234] (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b' "$install_log"; then
    exit "${statuses[0]}"
  fi
  echo "::warning::$install_command hit a transient download error (attempt $attempt/3); retrying the install."
  sleep "$((retry_delay * attempt))" || exit "$?"
done
