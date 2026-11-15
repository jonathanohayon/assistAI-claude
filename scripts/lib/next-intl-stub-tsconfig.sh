# Sourced (not run) by the scripts/*-db.sh suites that import a route handler
# calling next-intl's getTranslations. That call only works inside Next (the
# react-server condition + the Next plugin's "next-intl/config" alias), so
# under tsx it throws "`getTranslations` is not supported in Client
# Components". This writes ONE shared test tsconfig that maps
# "next-intl/server" to a stand-in built from the same message files
# (scripts/tests/helpers/next-intl-server-stub.ts); the app never sees it.
#
# Usage, from the repo root (every -db.sh cd's there first):
#   source scripts/lib/next-intl-stub-tsconfig.sh
#   write_next_intl_stub_tsconfig      # sets NEXT_INTL_STUB_TSCONFIG
#   env -i ... TSX_TSCONFIG_PATH="$NEXT_INTL_STUB_TSCONFIG" npx tsx <test>
#
# The file lives in the git-ignored .tmp/ and is rewritten on every call with
# the same bytes, so suites (always run one after the other) can share it.

write_next_intl_stub_tsconfig() {
  mkdir -p .tmp
  NEXT_INTL_STUB_TSCONFIG="$PWD/.tmp/tsconfig.next-intl-stub.json"
  cat > "$NEXT_INTL_STUB_TSCONFIG" <<'JSON'
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "paths": { "@/*": ["../*"], "next-intl/server": ["../scripts/tests/helpers/next-intl-server-stub.ts"] }
  }
}
JSON
}
