# Chartroom

An interactive map of your codebase in the [Herdr app](https://herdr.dev), drawn by your own Claude.

The Chartroom reads a project, asks `claude` to name its parts and describe every file, and shows the result as a chart you can explore: the app's parts as cards, what uses what as lines, one level at a time.

## Features

- **Chart**: three bands per level (what uses a part, what is inside it, what it uses), laid out with [ELK](https://eclipse.dev/elk/), with lines at right angles.
- **Explore**: double-click a card to go inside, scroll to zoom, drag to move around.
- **Explain**: have Claude explain any card. Explanations are kept until the chart changes.
- **Ask**: ask Claude a question about a card or level, and see the cards in its answer lit on the chart.
- **Stay current**: the Chartroom notices when the code has moved on since the chart, and an update re-describes only the files that changed.
- **Any project**: follow the focused space, or pick any project or folder.

## Requirements

- The Herdr app
- [Bun](https://bun.sh), `git` and `jq`
- The Claude Code CLI, logged in

## Install

```sh
git clone https://github.com/PieterLuypaert/chartroom.git
cd chartroom
./install.sh
```

This installs the dependencies, links the mod into `~/.config/herdr-app/mods/`, binds its keys, and adds a **Chartroom** button to the tab bar of your current layout. Run it again after pulling.

## Usage

Click **Chartroom** in the tab bar, or press `⌥⌘F`, to open it full size. `⌥⇧⌘F` opens it as a side panel. In a project without a chart, click **Draw the chart**.

| Key | Action |
|---|---|
| `↑` `↓` | Pick a card |
| `↵` / `⌫` | Go inside / up a level |
| `e` | Explain the card picked |
| `a` | Ask a question |
| `d` | Show or hide the details |
| `−` `+` `0` | Zoom out, in, fit |
| `u` | Update the chart |
| `p` | Pick another project |

## How it works

1. **Scan**: the code is read without Claude. Imports are followed through TypeScript, Python, Go and PHP, and web requests are matched to the endpoints that answer them.
2. **Parts**: one read-only `claude -p` call names the app's parts and the outside services it uses.
3. **Describe**: files are described in parallel batches on a faster model.
4. **Chart**: the result is written to `.chartroom/` in the project. That folder keeps itself out of git.

Everything runs locally, on your own Claude subscription. Claude only gets tools that read: it never changes your code.

## Development

```sh
bun test                          # unit and end-to-end tests
herdr-app check mods/chartroom    # load the mod once
bun draw/draw.js <folder>         # draw a chart from the command line
```

`draw/` holds the drawing (scan, Claude calls, layout); `mods/chartroom/` holds the panel.
