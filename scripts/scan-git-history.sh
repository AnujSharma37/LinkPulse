#!/usr/bin/env bash
# Scans the WHOLE git history (every branch, every commit, including files that were later deleted) for
# committed secrets. Needs only git + grep. Run it in your real repository:  ./scripts/scan-git-history.sh
# Exit code 0 = nothing suspicious found, 1 = review the findings (and ROTATE any real key you see),
# 2 = not a git repository. For a deeper scan also run:  gitleaks detect --source . --log-opts="--all"
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repository."; exit 2; }
found=0

echo "== 1. Environment / key files that were ever committed"
files=$(git log --all --pretty=format: --name-only --diff-filter=A | sort -u \
  | grep -E '(^|/)\.env(\.[^/]*)?$|\.pem$|\.key$|(^|/)id_(rsa|ed25519)$' | grep -vE '\.env\.example$' || true)
if [ -n "$files" ]; then echo "$files" | sed 's/^/  FOUND: /'; found=1; else echo "  none"; fi

echo "== 2. Secret-looking strings in any commit (added OR removed lines)"
PATTERN='AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9A-Za-z]+|sk-[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}|postgres(ql)?://[^:/ @]+:[^@ ]{6,}@|(SMTP_PASS|RESEND_API_KEY|GOOGLE_SAFE_BROWSING_API_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY)[ ]*=[ ]*[^ ]{8,}'
hits=$(git log --all -p -U0 --no-color --pretty='@@COMMIT %h %ad %s' --date=short \
  | grep -E "^@@COMMIT |^[+-][^+-].*($PATTERN)" \
  | grep -vE 'postgres://postgres:postgres@localhost|@localhost|@example\.com|your[-_]?(key|password)' \
  | awk '/^@@COMMIT /{c=$0; next} {print c; print "     " substr($0,1,110)}' || true)
if [ -n "$hits" ]; then echo "$hits"; found=1; else echo "  none"; fi

if [ "$found" -eq 1 ]; then
  echo; echo "Review the findings above. Anything real must be ROTATED at the provider: removing it from the latest commit does not make it safe."
  exit 1
fi
echo; echo "No committed secrets found by these checks."
