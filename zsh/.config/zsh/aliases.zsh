# Curated personal aliases
# Ported and curated from Nix home-manager/aliases.nix

# Shell management
alias reload="source $HOME/.zshrc && clear"
alias rl="reload"
alias restart="exec zsh"
alias re="restart"
alias zshconfig="nv ~/.zshrc"
alias ohmyzsh="cd ~/.oh-my-zsh"
alias ghosttyconfig="nv ~/.config/ghostty/config"

# Navigation
alias dl="cd ~/Downloads"
alias docs="cd ~/dev"
alias cdf='cd $(ls -d */ | fzf)'

# Modern CLI replacements
alias cat="bat"
alias find="fd"
alias top="btop"

# Editor
alias nv="nvim"
alias v="nvim"
alias vim="nvim"

# Safer / friendlier defaults
alias mkdir="mkdir -p"
alias cp="cp -r"
alias mv="mv -i"
# NOTE: deliberately not aliasing rm here — see ~/.zshrc.local if needed.

# eza variants (override `ls` only — base `ls` already aliased in .zshrc)
alias lsa="eza -la"
alias lst="eza -T"
alias lsta="eza -Ta"
alias lsr="eza -R"
alias lsg="eza -l --git"
alias lsm="eza -l --sort=modified"
alias lss="eza -l --sort=size"

# Terraform
alias tf="terraform"
alias tfin="terraform init"
alias tfp="terraform plan"
alias tfi="tfswitch -i"
alias tfu="tfswitch -u"
alias tfl="tfswitch -l"
# (Terragrunt aliases live on the gametime branch; not on personal)

# Docker
alias d="docker"
alias dc="docker-compose"

# Network
alias ipp="curl https://ipecho.net/plain; echo"

# System monitoring
alias htop="btop"
alias df="duf"
alias dfa="duf --all"
alias dfh="duf --hide-fs tmpfs,devtmpfs,efivarfs"
alias dfi="duf --only local,network"
alias bm="btm --basic"
alias bmp="btm --process_command"
alias bmt="btm --tree"
alias bmb="btm --battery"
alias cpu="btm --basic --cpu_left_legend"
alias mem="btm --basic --memory_legend none"
alias net="btm --basic --network_legend none"
alias sys="neofetch"
alias sysinfo="neofetch"
alias fetch="neofetch"

# Help / docs
alias h="tldr"
alias help="tldr"
alias rtfm="tldr"
alias cheat="tldr"
alias tldr-update="tldr --update"

# fd (find replacement) shortcuts
alias fdh="fd -H"
alias fa="fd -a"
alias ft="fd -tf --changed-within 1d"
alias fdir="fd -td"
alias ff="fd -tf"
alias fsym="fd -tl"
alias fpy="fd -e py"
alias fjs="fd -e js"
alias fsh="fd -e sh"
alias fmd="fd -e md"
alias fconf="fd -e conf -e config"

# Git (interactive)
alias gcb='git branch --all | grep -v HEAD | fzf --preview "git log --oneline --graph --date=short --color=always --pretty=\"%C(auto)%cd %h%d %s\" {1}" | sed "s/.* //" | xargs git checkout'

# Git basics (ported from git.nix shellAliases)
alias gp="git push"
alias gl="git pull"
alias gs="git status"
alias gd="git diff"
alias gpush='git add . && git commit -m'
alias gpushf='git add . && git commit --amend --no-edit && git push -f'
alias gpushnew='git push -u origin HEAD'
alias gare="git remote add upstream"
alias gre="git remote -v"
alias gcan='git add -A; git rm $(git ls-files --deleted) 2> /dev/null; git commit -v -a --no-edit --amend'
alias gfa="git fetch --all"
alias gfap="git fetch --all --prune"

# LazyGit
alias lg="lazygit"
alias lgc='lazygit -w $(pwd)'
alias lgf='lazygit -f $(find . -type d -name ".git" -exec dirname {} \; | fzf)'

# Git history (interactive)
alias fshow='git log --graph --color=always --format="%C(auto)%h%d %s %C(black)%C(bold)%cr" | fzf --ansi --preview "echo {} | grep -o \"[a-f0-9]\{7\}\" | head -1 | xargs -I % sh -c \"git show --color=always %\""'
alias fstash='git stash list | fzf --preview "echo {} | cut -d: -f1 | xargs -I % sh -c \"git stash show --color=always %\"" | cut -d: -f1 | xargs -I % sh -c "git stash apply %"'

# File / content navigation
alias fe='fzf --preview "bat --color=always --style=numbers --line-range=:500 {}" | xargs -r nano'
alias ffp='fzf --preview "bat --color=always --style=numbers --line-range=:500 {}"'
alias fcd='cd $(find . -type d -not -path "*/\.*" | fzf)'
alias fif='rg --color=always --line-number --no-heading --smart-case "" | fzf --ansi --preview "bat --color=always --style=numbers {1} --highlight-line {2}"'

# Process / memory
alias fkill="ps -ef | sed 1d | fzf -m | awk '{print \$2}' | xargs kill -9"
alias fmem="ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%mem | head -20 | fzf --header-lines=1"

# History / env
alias hist="history 0 | fzf --ansi --preview 'echo {}' | sed 's/ *[0-9]* *//'"
alias fenv="env | fzf --preview 'echo {}' | cut -d= -f2"

# Docker (interactive)
alias dsp='docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | fzf --header-lines=1 | awk "{print \$1}" | xargs -r docker stop'
alias drm='docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | fzf --header-lines=1 | awk "{print \$1}" | xargs -r docker rm'

# Markdown viewing
alias md="glow"
alias readme="glow README.md"
alias changes="glow CHANGELOG.md"

# tmux
alias tpi="tmux run-shell $HOME/.tmux/plugins/tpm/bindings/install_plugins"
alias tpu="tmux run-shell $HOME/.tmux/plugins/tpm/bindings/update_plugins"
alias tpU="tmux run-shell $HOME/.tmux/plugins/tpm/bindings/clean_plugins"
alias tn="tmux new -s"
alias ta="tmux attach -t"
alias tl="tmux list-sessions"
alias tk="tmux kill-session -t"
alias t="tmux new-session -A -s main"

# Smart editor for dotfiles
codedot() {
    if command -v cursor &> /dev/null; then
        cursor "$HOME/dev/dotfiles"
    else
        code "$HOME/dev/dotfiles"
    fi
}

# Jupyter
alias jlab="jupyter lab"

# macOS Finder controls
alias show="defaults write com.apple.finder AppleShowAllFiles -bool true && killall Finder"
alias hide="defaults write com.apple.finder AppleShowAllFiles -bool false && killall Finder"
alias hidedesktop="defaults write com.apple.finder CreateDesktop -bool false && killall Finder"
alias showdesktop="defaults write com.apple.finder CreateDesktop -bool true && killall Finder"

# macOS volume / lock
alias stfu="osascript -e 'set volume output muted true'"
alias pumpitup="osascript -e 'set volume output volume 100'"
alias afk='osascript -e "tell application \"System Events\" to keystroke \"q\" using {command down,control down}"'

# AWS profile switching (paired with aws/.local/bin/copy_and_unset, see Task 4a)
alias awsdef='osascript -e "tell application \"System Events\" to keystroke \"k\" using command down" && $HOME/.local/bin/copy_and_unset default'
alias awsprod='osascript -e "tell application \"System Events\" to keystroke \"k\" using command down" && $HOME/.local/bin/copy_and_unset production'
alias awsdev='osascript -e "tell application \"System Events\" to keystroke \"k\" using command down" && $HOME/.local/bin/copy_and_unset development'
export AWS_DEFAULT_REGION=us-west-2
export AWS_REGION=us-west-2

# Google Cloud
alias gauth='op read "op://Telophase QS/GCP ADC OAuth Client - tqs-dev/client_secret_821909658093-llr9utmgsb7u97nk4kv5679mtv2a2e60.apps.googleusercontent.com.json" > /tmp/adc_client_secret.json && gcloud auth login && gcloud auth application-default login --client-id-file=/tmp/adc_client_secret.json'
alias gauthuser="gcloud auth login"
alias gauthapp='op read "op://Telophase QS/GCP ADC OAuth Client - tqs-dev/client_secret_821909658093-llr9utmgsb7u97nk4kv5679mtv2a2e60.apps.googleusercontent.com.json" > /tmp/adc_client_secret.json && gcloud auth application-default login --client-id-file=/tmp/adc_client_secret.json'
alias gauthls="gcloud auth list"
alias gauthinfo="gcloud config list"
alias gcl="gcloud config configurations list"
alias gcs="gcloud config configurations activate"
alias gci="gcloud config list"
alias gpl="gcloud projects list"
alias gps="gcloud config set project"
export USE_GKE_GCLOUD_AUTH_PLUGIN=True
# Source gcloud path + completion (installed via mise run gcloud-install)
if [ -f "$HOME/google-cloud-sdk/path.zsh.inc" ]; then
    source "$HOME/google-cloud-sdk/path.zsh.inc"
fi
if [ -f "$HOME/google-cloud-sdk/completion.zsh.inc" ]; then
    source "$HOME/google-cloud-sdk/completion.zsh.inc"
fi

# gh — interactive functions and aliases (ported from github.nix)
function ghpr()       { gh pr list --state "$1" --limit 1000 | fzf; }
function ghprall()    { gh pr list --state all  --limit 1000 | fzf; }
function ghpropen()   { gh pr list --state open --limit 1000 | fzf; }
function ghopr()      { id="$(ghprall | cut -f1)"; [ -n "$id" ] && gh pr view "$id" --web; }
function ghprcheck()  { id="$(ghpropen | cut -f1)"; [ -n "$id" ] && gh pr checks "$id"; }
function ghprco() {
    if [ $# -eq 0 ]; then
        local PR_NUM=$(gh pr list --state open | fzf | cut -f1)
        [ -n "$PR_NUM" ] && gh pr checkout "$PR_NUM"
    else
        case "$1" in
            -f|--force)  gh pr checkout "$2" --force  ;;
            -d|--detach) gh pr checkout "$2" --detach ;;
            *)           gh pr checkout "$1"           ;;
        esac
    fi
}
alias ghprcr="gh pr create --web"
alias ghprv="ghopr"
alias ghprl="ghprall"
alias ghpro="ghpropen"
alias ghprc="ghprco"
alias ghprch="ghprcheck"
alias ghrv="gh repo view --web"
alias ghrc="gh repo clone"
alias ghrf="gh repo fork"
alias ghil="gh issue list"
alias ghic="gh issue create --web"
alias ghiv="gh issue view --web"
alias ghrl="gh run list"
alias ghrw="gh run watch"
alias ghrs="gh repo search"
alias ghis="gh issue search"
alias ghps="gh pr search"

# Custom helper: print default branch
function gitdefaultbranch() {
    git remote show origin | grep 'HEAD' | cut -d':' -f2 | sed -e 's/^ *//g' -e 's/ *$//g'
}
