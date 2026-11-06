# Chartroom

[![Tests](https://github.com/PieterLuypaert/chartroom/actions/workflows/test.yml/badge.svg)](https://github.com/PieterLuypaert/chartroom/actions/workflows/test.yml)

An interactive map of your codebase in the [Herdr app](https://herdr.dev), drawn by your own Claude.

The Chartroom reads a project, asks `claude` to name its parts and describe every file, and shows the result as a chart you can explore: the app's parts as cards, what uses what as lines, one level at a time.

![Portly's chart in the Chartroom: the whole app, the part How the list looks picked with its lines lit, and its details beside the chart](preview.png)

Go inside a part to see its files:

![Inside Portly's Commands and launcher: the file Typed commands picked, its lines lit to the six parts it uses](docs/inside-a-part.png)

## Features

- **Chart**: three bands per level (what uses a part, what is inside it, what it uses), laid out with [ELK](https://eclipse.dev/elk/), with lines at right angles.
- **Explore**: double-click a card to go inside, scroll to zoom, drag to move around. The minimap in the bottom-left corner shows where you are; click or drag it to move there.
- **Explain**: have Claude explain any card. Explanations are kept until the chart changes.
- **Ask**: ask Claude a question about a card or level, and see the cards in its answer lit on the chart. Each card and level keeps its own questions: picking a card shows only what was asked about it.
- **Stay current**: the Chartroom notices when the code has moved on since the chart, and an update re-describes only the files that changed.
- **Any project**: follow the focused space, or pick any project or folder.
- **Any theme**: it uses only your Herdr theme's colors, so it follows a theme change at once, light or dark.

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

This installs the dependencies, links the mod into `~/.config/herdr-app/mods/`, binds its keys, and adds a **Chartroom** button to the tab bar of your current layout. Herdr replaces its own layouts (`main`, `terminals`, `win98`) on every start, so use a layout of your own: `install.sh` tells you how to clone one.

After pulling, run `./install.sh` again and restart Herdr: it does not reload a linked mod by itself.

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

The tests need no Claude and no Herdr app: a stand-in `claude` (`tests/fake-claude.js`) answers in the shape asked, and `install.sh` runs against a Herdr home of its own. `tests/e2e.test.js` takes the panel's whole way through the same shell snippets it runs: a project drawn in the background, its levels laid out by ELK, questions asked per card and per level, a card explained, and an update after a commit. GitHub runs them on Linux and macOS for every push and pull request.

## Build it from the recipe

[RECIPE.md](RECIPE.md) describes the Chartroom for an agent to build from an empty folder.

## License

[MIT](LICENSE)
