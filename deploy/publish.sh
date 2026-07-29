#!/usr/bin/env bash
# Build the static publication and publish it to the gh-pages branch.
# The collector owns the publish-pending marker. This script removes it only
# after the remote branch is confirmed current, so failed pushes are retried.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
STATE_DIR="$ROOT_DIR/collector/state"
PENDING_FILE="$STATE_DIR/publish-pending"
DIST_DIR="$ROOT_DIR/site/dist"
REPOSITORY="${MARGINALTOKEN_REPO:-git@github.com:mctar/marginaltoken.git}"

if [ ! -f "$PENDING_FILE" ]; then
    echo "No pending feed revision."
    exit 0
fi

cd "$ROOT_DIR"
if [ ! -d "$ROOT_DIR/site/node_modules" ]; then
    npm ci --prefix site
fi
npm run build

DEPLOY_DIR="$(mktemp -d /tmp/marginaltoken-ghp.XXXXXX)"
cleanup() {
    case "$DEPLOY_DIR" in
        /tmp/marginaltoken-ghp.*) rm -rf -- "$DEPLOY_DIR" ;;
        *) echo "Refusing to clean unexpected path: $DEPLOY_DIR" >&2 ;;
    esac
}
trap cleanup EXIT

git clone --no-checkout "$REPOSITORY" "$DEPLOY_DIR"
cd "$DEPLOY_DIR"
if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then
    git checkout -B gh-pages origin/gh-pages
else
    git checkout --orphan gh-pages
fi

find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf -- {} +
cp -R "$DIST_DIR"/. "$DEPLOY_DIR"/

git config user.name "Marginal Token Collector"
git config user.email "collector@marginaltoken.com"
git add -A
if git diff --cached --quiet; then
    echo "The gh-pages branch already contains this revision."
else
    git commit -m "Update token prices $(date -u +%Y-%m-%dT%H:%MZ)"
    git push origin gh-pages
    echo "Published the pending feed revision."
fi

rm -f "$PENDING_FILE"
