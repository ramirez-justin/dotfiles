#!/bin/bash

# Claude Code statusline script
# Reads JSON input from stdin and displays formatted statusline with development info

input=$(cat)

# Extract info from JSON
current_dir=$(echo "$input" | jq -r '.workspace.current_dir' | sed "s|$HOME|~|")
model=$(echo "$input" | jq -r '.model.display_name')
session_id=$(echo "$input" | jq -r '.session_id' | cut -c1-8)
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')
version=$(echo "$input" | jq -r '.version')

# Get git info if in a git repo
git_info=""
if git rev-parse --git-dir >/dev/null 2>&1; then
	branch=$(git branch --show-current 2>/dev/null)
	if [ -n "$branch" ]; then
		# Check if there are uncommitted changes
		if ! git diff-index --quiet HEAD -- 2>/dev/null; then
			git_info="🔄 $branch*"
		else
			git_info="🌿 $branch"
		fi
	fi
fi

# Build status line with sections separated by |
status_line=""

# Directory section
status_line="📁 $current_dir"

# Git section (if available)
if [ -n "$git_info" ]; then
	status_line="$status_line | $git_info"
fi

# Model section
status_line="$status_line | 🤖 $model"

# Session info
if [ "$session_id" != "null" ] && [ -n "$session_id" ]; then
	status_line="$status_line | 🎯 $session_id"
fi

# Context window usage
context_info=""
usage=$(echo "$input" | jq '.context_window.current_usage')
if [ "$usage" != "null" ]; then
	current=$(echo "$usage" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
	size=$(echo "$input" | jq '.context_window.context_window_size')
	if [ "$size" != "null" ] && [ "$size" != "0" ]; then
		pct=$((current * 100 / size))

		# Create progress bar (10 characters wide)
		filled=$((pct / 10))
		empty=$((10 - filled))
		bar=""
		for ((i = 0; i < filled; i++)); do bar+="█"; done
		for ((i = 0; i < empty; i++)); do bar+="░"; done

		context_info="[${bar} ${pct}%]"
		status_line="$status_line | 📊 $context_info"
	fi
fi

# Lines changed info (if available and > 0)
if [ "$lines_added" != "0" ] && [ "$lines_added" != "null" ] || [ "$lines_removed" != "0" ] && [ "$lines_removed" != "null" ]; then
	status_line="$status_line | ✏️ +$lines_added/-$lines_removed"
fi

# Cost info (if available and > 0)
if [ "$cost" != "0" ] && [ "$cost" != "null" ]; then
	status_line="$status_line | 💰 \$$(printf '%.4f' "$cost")"
fi

# Version info
if [ "$version" != "null" ] && [ -n "$version" ]; then
	status_line="$status_line | 🔢 $version"
fi

# Output with dimmed formatting
printf "\033[2m%s\033[0m" "$status_line"
