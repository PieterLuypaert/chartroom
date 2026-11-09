# Adds the Chartroom to a Herdr app layout: its panel as a column on the right of the window, hidden
# until cmd-alt-f or the button opens it, and its button at the end of the tab bar's row, so the tab
# bar's own mod stays as it is. Where the Quarterdeck is there already, the Chartroom's panel and
# button go just before its own, in the row the Quarterdeck made.
# The panel stays narrow enough to leave the terminals room on a laptop: full size is a tab.
def panel: { id: "chartroom", type: "block", hidden: true, size: { px: 460 }, min: 340, max: 600, content: { mod: "chartroom" } };
def button: { id: "chartroom-button", type: "block", size: { px: 108 }, window_drag: true, content: { mod: "chartroom", props: { button: true } } };
def before($id; $block): if any(.children[]; .id? == $id) then .children |= map(if .id? == $id then $block, . else . end) else .children += [$block] end;
def tabs_row: { id: "tabs-row", type: "row", resizable: false, children: [(del(.size) + { size: { weight: 1 } }), button] } + (if .size then { size: .size } else {} end);

# The tab bar the button goes into: the block called tabs, else the first block drawn by one of
# Herdr's tab bar mods (tabs in main, terminals-bar in terminals), whatever its id. Only one gets the
# button.
def is_block: type == "object" and .type? == "block";
def tab_bar: first(paths(is_block and .id? == "tabs")) // first(paths(is_block and ((.content.mod? // "") | . == "tabs" or . == "terminals-bar"))) // null;
def with_button: tab_bar as $at | if $at == null then . else setpath($at; getpath($at) | tabs_row) end;

# A root that is not a row (Herdr's own terminals and win98 are columns) is made one, so the panel has
# a right side to go on. The root keeps the layout's settings and look (titlebar, theme, background,
# padding and the like), which then reach the panel too; the window it held moves into the row's
# first child, chartroom-wrap, with what arranges that window's own children.
def arranging: ["type", "children", "gap", "divider", "resizable", "active", "header", "content", "window_drag"];
def as_row:
  if .type == "row" then .
  else (with_entries(select(.key as $key | any(arranging[]; . == $key)))) as $window
    | with_entries(select(.key as $key | any(arranging[]; . == $key) | not))
      + { type: "row", children: [$window + { id: "chartroom-wrap", size: { weight: 1 } }] }
  end;

if type != "object" or (.id? | type) != "string" then error("it is not a layout: its root has no id")
else as_row
  | if any(.. | objects; .id? == "tabs-row") then walk(if type == "object" and .id? == "tabs-row" then before("quarterdeck-button"; button) else . end) | before("quarterdeck"; panel)
    else with_button | before("quarterdeck"; panel)
    end
end
