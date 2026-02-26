#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# AgentOS Installer
#
# Local:   ./install.sh
# Remote:  curl -fsSL https://raw.githubusercontent.com/USER/agent-os/main/install.sh | bash
# ─────────────────────────────────────────────

REPO_URL="${AGENTOS_REPO:-https://github.com/thiagoneves/agentos-core.git}"

# ── Colors ────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()    { printf "${BLUE}▸${RESET} %s\n" "$*"; }
success() { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}⚠${RESET} %s\n" "$*"; }
error()   { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
fatal()   { error "$@"; exit 1; }

banner() {
  printf "\n"
  printf "${BOLD}${CYAN}"
  printf "   ╔══════════════════════════════════════╗\n"
  printf "   ║          ${RESET}${BOLD}⚡ AgentOS Installer${CYAN}        ║\n"
  printf "   ║  ${RESET}${DIM}Modular OS for AI-powered teams${CYAN}     ║\n"
  printf "   ╚══════════════════════════════════════╝\n"
  printf "${RESET}\n"
}

# ── Detect where install.sh lives ─────────────

detect_source() {
  # If running from inside the repo, use the local path
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"agent-os"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
    SOURCE="local"
    SOURCE_DIR="$SCRIPT_DIR"
    info "Source: local (${SOURCE_DIR})"
  else
    SOURCE="remote"
    info "Source: remote (${REPO_URL})"
  fi
}

# ── Prerequisite Checks ──────────────────────

check_command() {
  command -v "$1" &>/dev/null
}

check_node() {
  if ! check_command node; then
    error "Node.js is required but not installed."
    printf "\n"
    info "Install Node.js (v18+):"
    printf "   ${DIM}curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts${RESET}\n"
    printf "   ${DIM}Or: https://nodejs.org${RESET}\n"
    printf "\n"
    exit 1
  fi

  local node_version major
  node_version=$(node -v | sed 's/^v//')
  major=$(echo "$node_version" | cut -d. -f1)

  if [ "$major" -lt 18 ]; then
    fatal "Node.js v18+ required (found v${node_version})."
  fi

  success "Node.js v${node_version}"
}

detect_package_manager() {
  if check_command bun; then
    PKG="bun"
  elif check_command pnpm; then
    PKG="pnpm"
  elif check_command npm; then
    PKG="npm"
  else
    fatal "No package manager found (npm, pnpm, or bun)."
  fi
  success "Package manager: ${PKG}"
}

check_runners() {
  local found=false
  check_command claude  && { success "Runner: Claude Code"; found=true; }
  check_command cursor  && { success "Runner: Cursor"; found=true; }
  check_command gemini  && { success "Runner: Gemini CLI"; found=true; }

  if [ "$found" = false ]; then
    warn "No AI runner detected (install Claude Code, Cursor, or Gemini CLI)"
  fi
}

# ── Install ───────────────────────────────────

install_local() {
  info "Building from local source..."

  cd "$SOURCE_DIR"

  $PKG install 2>&1 | tail -1
  $PKG run build 2>&1 | tail -1

  # npm link creates global symlinks: aos, agentos
  npm link 2>&1 | tail -1

  success "Linked globally from ${SOURCE_DIR}"
}

install_remote() {
  info "Cloning from ${REPO_URL}..."

  local tmp_dir
  tmp_dir=$(mktemp -d)

  git clone --depth 1 "$REPO_URL" "$tmp_dir/agent-os" 2>/dev/null \
    || fatal "Failed to clone. Check the URL or your network."

  cd "$tmp_dir/agent-os"

  $PKG install 2>&1 | tail -1
  $PKG run build 2>&1 | tail -1
  npm link 2>&1 | tail -1

  success "Installed from ${REPO_URL}"
  info "Source cloned to: ${tmp_dir}/agent-os"
}

# ── Verify ────────────────────────────────────

verify() {
  printf "\n"
  if check_command aos; then
    success "aos command available: $(which aos)"
  elif check_command agentos; then
    success "agentos command available: $(which agentos)"
  else
    warn "Command not in PATH. Restart your terminal or add to PATH."
    return
  fi

  # Quick smoke test
  aos --version 2>/dev/null && success "Version check passed" || true
}

# ── Next steps ────────────────────────────────

next_steps() {
  printf "\n"
  printf "${BOLD}${GREEN}  ✓ Installation complete!${RESET}\n"
  printf "\n"
  printf "  ${BOLD}Quick start:${RESET}\n"
  printf "\n"
  printf "    ${CYAN}\$${RESET} cd your-project\n"
  printf "    ${CYAN}\$${RESET} aos init           ${DIM}# initialize .agentos/${RESET}\n"
  printf "    ${CYAN}\$${RESET} aos install sdlc   ${DIM}# install SDLC module${RESET}\n"
  printf "    ${CYAN}\$${RESET} aos doctor          ${DIM}# check health${RESET}\n"
  printf "    ${CYAN}\$${RESET} aos run feature-dev ${DIM}# start a workflow${RESET}\n"
  printf "\n"
  printf "  ${BOLD}Useful commands:${RESET}\n"
  printf "\n"
  printf "    ${CYAN}aos sync${RESET}     Regenerate CLAUDE.md and runner files\n"
  printf "    ${CYAN}aos doctor${RESET}   Diagnostics and health check\n"
  printf "    ${CYAN}aos --help${RESET}   Show all commands\n"
  printf "\n"
  printf "  ${DIM}Uninstall: npm unlink -g agent-os${RESET}\n"
  printf "\n"
}

# ── Language Selection ────────────────────────

ask_language() {
  printf "${BOLD}  Language / Idioma / Idioma${RESET}\n\n"
  printf "  ${CYAN}1)${RESET} en     ${DIM}English${RESET}\n"
  printf "  ${CYAN}2)${RESET} pt-BR  ${DIM}Português (Brasil)${RESET}\n"
  printf "  ${CYAN}3)${RESET} es     ${DIM}Español${RESET}\n"
  printf "\n"

  local choice
  printf "  ${BLUE}▸${RESET} Select [1-3] (default: 1): "
  read -r choice

  case "$choice" in
    2) LANG_CODE="pt-BR" ;;
    3) LANG_CODE="es" ;;
    *) LANG_CODE="en" ;;
  esac

  success "Language: ${LANG_CODE}"
  printf "\n"
}

# ── Main ──────────────────────────────────────

main() {
  banner
  detect_source
  printf "\n"

  ask_language

  printf "${BOLD}  Prerequisites${RESET}\n\n"
  check_node
  detect_package_manager
  check_runners
  printf "\n"

  printf "${BOLD}  Installing${RESET}\n\n"
  if [ "$SOURCE" = "local" ]; then
    install_local
  else
    install_remote
  fi

  verify
  next_steps
}

main "$@"
