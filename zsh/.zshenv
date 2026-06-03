# Keep zsh's standard autoload functions available even when a parent shell
# exports a stale FPATH after Homebrew zsh upgrades.
if [[ -n "$ZSH_VERSION" ]]; then
  fpath=(
    /opt/homebrew/share/zsh/functions
    /usr/share/zsh/$ZSH_VERSION/functions
    /usr/local/share/zsh/site-functions
    /opt/homebrew/share/zsh/site-functions
    $fpath
  )
  typeset -U fpath
fi

. "$HOME/.cargo/env"
