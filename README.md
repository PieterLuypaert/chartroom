# Chartroom

A chart of a project's code in the [Herdr app](https://herdr.dev), in a panel beside the [Quarterdeck](https://github.com/PieterLuypaert/quarterdeck): its parts as cards, what uses what as lines between them, one level at a time.

It reads the map [floorplan](https://github.com/haydenschmitty/floorplan) writes for Claude Code (`floorplan/graph.json`) and draws it natively, in the app's own look.

## What it shows

- **The chart**: the parts of the app at the top, and inside any part its parts and files. What uses a card sits above it; the outside cards that use a part sit on top, the outside services it uses at the bottom.
- **A card's details**: what it does, what it uses and what uses it (with the requests or imports in between), and for a file its endpoints.
- **Any project**: the focused space's by default, or one picked from every space's project and folders chosen by hand, each marked with whether it has a chart yet.
- **Always current**: the chart is read again as soon as floorplan writes it.

With no chart yet, **Draw it with Claude** opens a Claude tab in the project that asks for one; the header's pen asks Claude to update it.

## Install

From a checkout, with the Herdr app opened once:

```sh
./install.sh             # or ./install.sh <layout>
```

It links the mod into `~/.config/herdr-app/mods/`, binds `cmd-alt-f`, and adds the panel and a **Chartroom** button to the current layout, before the Quarterdeck's when that is there. Herdr resets its own layouts on start, so the script tells you how to clone one first. Run it again after a pull so the app loads the new mod.

Drawing a chart needs floorplan in Claude Code:

```sh
claude plugin marketplace add haydenschmitty/floorplan
claude plugin install floorplan@floorplan
```

## Keys

| Key | In the chart | In the project list |
|---|---|---|
| `↑` / `↓` | pick the card before or after | move through the projects |
| `enter` | go inside the card picked | chart that project |
| `backspace` | up a level | |
| `p` | the project list | back to the chart |
| `u` | ask Claude to draw or update the chart | |
| `o` | floorplan's own map in the browser | |
| `esc` | up a level, or close | back to the chart |

A click picks a card, a double click goes inside it, and the trail under the header leads back up.

## Develop

```sh
bun test
herdr-app check mods/chartroom
```

- `mods/chartroom/model.js`: the map read into levels of cards and lines; `layout.js`: where each card goes and the curve of each line; `find.js`: the shell that finds a project's map.
- `mods/chartroom/main.js`: the panel and the tab bar's button; `chart.js` and `projects.js` draw the chart, the details and the project list.
