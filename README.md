# Chartroom

A chart of a project's code in the [Herdr app](https://herdr.dev), in a panel beside the [Quarterdeck](https://github.com/PieterLuypaert/quarterdeck): its parts as cards, what uses what as lines between them, one level at a time, all in plain words.

The panel draws the chart itself, with your own Claude: it reads the code, asks `claude` for the app's parts and a description of every file and endpoint, and shows the result as soon as it is there.

## What it shows

- **The chart**: the parts of the app at the top, and inside any part its parts and files. What uses a card sits above it; the outside cards that use a part sit on top, the outside services it uses at the bottom.
- **A card's details**: what it does, what it uses and what uses it (with the requests or imports in between), and for a file its endpoints.
- **Any project**: the focused space's by default, or one picked from every space's project and folders chosen by hand, each marked with whether it has a chart yet.
- **Full size**: the square in the header (or `f`) opens the Chartroom in a tab of its own, on the same project and level. As any pane, `⌘⇧↵` zooms it, and the window's full screen makes it the whole screen. A wide view fits more cards on a row and puts the details beside the chart.
- **Smooth**: a level fades in when you go inside a part or back up, a picked card's lines fade in, and the cards glide to their new places when the view is resized.
- **Drawing and updating**: **Draw the chart** starts it in the background and shows each step as it goes; the header's pen brings it up to date, asking Claude only about the files that changed. It keeps running when the panel closes, and **Stop** ends it.

A project that has a map made by [floorplan](https://github.com/haydenschmitty/floorplan) shows that map until the Chartroom draws its own.

## How a chart is drawn

1. **Reading the code** (no Claude): the repos in the folder, every code file git knows, and what each imports, defines, answers and asks for. Imports are followed to the files they lead to (TypeScript paths and baseUrl, Python modules, Go modules, PHP's PSR-4), and each web request is matched to the endpoint that answers it, across repos too.
2. **Finding the app's parts**: one `claude -p` call with only the tools that read, which names the parts, the outside services and the links the code cannot show.
3. **Describing every file**: batches of files, several at once, on a faster model.
4. **Drawing the chart**: `.chartroom/chart.json` in the project. The `.chartroom` folder keeps itself out of git, and nothing else in the project is touched.

It runs on your Claude subscription, through the `claude` you are logged in with; nothing else leaves your machine. A first chart takes a few minutes for a small app and longer for a big one.

## Install

From a checkout, with the Herdr app opened once:

```sh
./install.sh             # or ./install.sh <layout>
```

It links the mod into `~/.config/herdr-app/mods/`, binds `cmd-alt-f` (which makes `keys.json` yours: Herdr no longer adds its new default shortcuts to it on an upgrade), and adds the panel and a **Chartroom** button to the current layout, before the Quarterdeck's when that is there. Herdr resets its own layouts on start, so the script tells you how to clone one first. Run it again after a pull so the app loads the new mod.

Needs Bun, and the Claude Code CLI logged in.

## Keys

| Key | In the chart | In the project list |
|---|---|---|
| `↑` / `↓` | pick the card before or after | move through the projects |
| `enter` | go inside the card picked | chart that project |
| `backspace` | up a level | |
| `p` | the project list | back to the chart |
| `u` | draw the chart, or bring it up to date | |
| `s` | stop the drawing | |
| `f` | the Chartroom full size, in a tab of its own | |
| `esc` | up a level, or close | back to the chart |

A click picks a card, a double click goes inside it, and the trail under the header leads back up.

## Develop

```sh
bun test
herdr-app check mods/chartroom
bun draw/draw.js <folder> [--update]     # draw a chart from the command line
```

- `draw/`: the drawing, run with Bun. `scan.js` reads the code (`extract.js` per file, `resolve.js` for imports and requests); `parts.js` and `describe.js` ask Claude through `claude.js`; `build.js` writes the chart; `draw.js` runs the steps and reports its progress.
- `mods/chartroom/`: the panel. `model.js` reads a chart into levels, `layout.js` places the cards and lines, `find.js` is the shell that finds a chart and starts or stops a drawing; `main.js` is the panel and the tab bar's button, and `chart.js`, `projects.js` and `drawing.js` draw it.
- Tests run the drawing end to end with a stand-in for `claude` (`tests/fake-claude.js`).
