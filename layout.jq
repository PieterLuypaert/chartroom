# Adds the Chartroom to a Herdr app layout: its panel as a column on the right of the window, hidden
# until cmd-alt-f or the button opens it, and its button at the end of the tab bar's row, so the tab
# bar's own mod stays as it is. Where the Quarterdeck is there already, the Chartroom's panel and
# button go just before its own, in the row the Quarterdeck made.
# The panel stays narrow enough to leave the terminals room on a laptop: full size is a tab.
def panel: { id: "chartroom", type: "block", hidden: true, size: { px: 460 }, min: 340, max: 600, content: { mod: "chartroom" } };
def button: { id: "chartroom-button", type: "block", size: { px: 108 }, window_drag: true, content: { mod: "chartroom", props: { button: true } } };
def before($id; $block): if any(.children[]; .id? == $id) then .children |= map(if .id? == $id then $block, . else . end) else .children += [$block] end;
def tabs_row: { id: "tabs-row", type: "row", resizable: false, children: [(del(.size) + { size: { weight: 1 } }), button] } + (if .size then { size: .size } else {} end);

if .type != "row" then error("its root is not a row, so there is no right side to put the panel on")
elif any(.. | objects; .id? == "tabs-row") then walk(if type == "object" and .id? == "tabs-row" then before("quarterdeck-button"; button) else . end) | before("quarterdeck"; panel)
else walk(if type == "object" and .id? == "tabs" then tabs_row else . end) | before("quarterdeck"; panel)
end
