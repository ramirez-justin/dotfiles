# zsh keybindings + FZF widgets
# Ported from Nix home-manager/modules/zsh.nix

# Interactive git status with file preview
function fzf-git-status() {
    local selections=$(
        git status --porcelain | \
        fzf --ansi \
            --preview 'if [ -f {2} ]; then
                            bat --color=always --style=numbers {2}
                        elif [ -d {2} ]; then
                            tree -C {2}
                        fi' \
            --preview-window right:70% \
            --multi
    )
    if [ -n "$selections" ]; then
        LBUFFER+="$(echo "$selections" | awk '{print $2}' | tr '\n' ' ')"
    fi
    zle reset-prompt
}
zle -N fzf-git-status

# Directory navigation with hidden files
function fzf-cd-with-hidden() {
    local dir
    dir=$(find "${1:-$PWD}" -type d 2> /dev/null | fzf +m) && cd "$dir"
    zle reset-prompt
}
zle -N fzf-cd-with-hidden

# History and Directory Navigation
autoload -U up-line-or-beginning-search
autoload -U down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
zle -N dirhistory_zle_dirhistory_up
zle -N dirhistory_zle_dirhistory_down

# Word Navigation: ALT-Left/Right
bindkey "^[f" forward-word
bindkey "^[b" backward-word

# Word Deletion: CTRL-Delete / ALT-Backspace
bindkey "^[[3;5~" kill-word
bindkey "^H" backward-kill-word
bindkey "^[^?" backward-kill-word

# Line editing
bindkey "^U" backward-kill-line

# Cursor: CTRL-A/E
bindkey "^A" beginning-of-line
bindkey "^E" end-of-line

# Directory history: ALT-Up / ALT-Down
bindkey "^[[1;3A" dirhistory_zle_dirhistory_up
bindkey "^[[1;3B" dirhistory_zle_dirhistory_down

# FZF widgets
bindkey -s '^_' 'code $(fzf)^M'   # CTRL-_ : open fzf-selected file in VS Code
bindkey "^[d" fzf-cd-with-hidden  # ALT-d  : fzf cd
bindkey '^G' fzf-git-status       # CTRL-G : fzf git status
