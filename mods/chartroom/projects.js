// The Chartroom's list of projects to chart, in a dropdown under the project button: following the
// focused space, every space's project, any folder picked by hand, and choosing another.
import { div, svg } from "gpui-kit";
import { h_flex, Scrollbar, v_flex, v_virtual_list } from "gpui-base";
import { dropdownFrame } from "./chart.js";
import { pickerItems } from "./model.js";

const ICONS = "mods/workspace-chrome";
const ROW_HEIGHT = 40;
const HEADING_HEIGHT = 26;
const ONE_LINE = 32;
// How many projects show before the list scrolls.
const SHOWN = 7;

// A folder as the spaces sidebar shows one: home as ~.
const shortFolder = (folder, home) => (home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder);

// The rows in the order the keys move through them: following the focus, each project, choosing.
export function pickerRows(projects) {
  return [{ kind: "follow" }, ...projects.map((project) => ({ kind: "project", project })), { kind: "choose" }];
}

// The dropdown. On top, following the focused space, with what it follows now; at the bottom,
// "Choose a folder…"; between them, the projects under "Spaces" and "Folders", each a row of two
// lines: its name, its machine when not this one, its chart in words and a check on the one
// charted, then its folder. The projects scroll past SHOWN, by the wheel or to keep the keys' row in
// view (`scroll`, which main.js moves). A press outside closes it and goes no further, so a press on
// the project button closes it rather than opening it again.
export function projectList({ t, projects, cursor, charted, pinned, focused, home, width, scroll, onRow, onClose }) {
  const rows = pickerRows(projects);
  const line = (id, index, height) => h_flex().id(id).w_full().h(height).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
    .role("list_box_option").when(index === cursor, (el) => el.bg(t.selected).aria_active_descendant()).hover((s) => s.bg(t.hover));
  const icon = (name) => svg(`${ICONS}/${name}.svg`).size(14).flex_none().text_color(t.muted);
  const check = (isCurrent) => (isCurrent ? svg(`${ICONS}/check.svg`).size(13).flex_none().text_color(t.accent) : div().w(13).flex_none());
  const follow = line("project-follow", 0, ROW_HEIGHT).on_click((_e, cx) => onRow(rows[0], cx))
    .child(icon("layers"))
    .child(twoLines(t, div().flex_shrink_1().min_w(0).truncate().child("Follow the focused space"), focused ? `Now: ${focused}` : "No space is focused"))
    .child(check(!pinned));
  const choose = line("project-choose", rows.length - 1, ONE_LINE).on_click((_e, cx) => onRow(rows.at(-1), cx))
    .child(icon("folder-plus"))
    .child(div().flex_1().text_size(12).text_color(t.muted).child("Choose a folder…"));
  return dropdownFrame(t, "projects", width)
    .on_mouse_down_out((_e, cx) => {
      cx.stop_propagation();
      onClose(cx);
    })
    .child(follow)
    .child(divider(t, "projects-above"))
    .when(projects.length > 0, (el) => el.child(projectRows({ t, projects, cursor, charted, pinned, home, scroll, line, icon, check, onRow })).child(divider(t, "projects-below")))
    .child(choose);
}

// The projects between "Follow" and "Choose": a virtual list, as only a virtual list scrolls from
// code. Its rows hold no handlers; a click comes to the list with the row's key.
function projectRows({ t, projects, cursor, charted, pinned, home, scroll, line, icon, check, onRow }) {
  const items = pickerItems(projects);
  const sizes = items.map((item) => (item.kind === "heading" ? HEADING_HEIGHT : ROW_HEIGHT));
  const keyOf = (item) => (item.kind === "heading" ? `heading ${item.label}` : `project ${item.project.key}`);
  const item = (one) => {
    if (one.kind === "heading") return div().id(keyOf(one)).w_full().h(HEADING_HEIGHT).flex_none().px(8).pt(9).text_size(11).font_medium().text_color(t.dim).child(one.label);
    const { project } = one;
    const isCurrent = pinned?.folder === project.folder && (pinned.on ?? null) === project.on;
    const found = charted.get(project.key);
    const name = h_flex().flex_shrink_1().min_w(0).gap(6).items_center()
      .child(div().flex_shrink_1().min_w(0).truncate().child(project.label))
      .when(Boolean(project.on), (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(project.on)));
    return line(keyOf(one), one.row, ROW_HEIGHT)
      .child(icon("folder"))
      .child(twoLines(t, name, found?.error ?? shortFolder(project.folder, home), chartWords(t, found), Boolean(found?.error)))
      .child(check(isCurrent));
  };
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return v_flex().relative().h(Math.min(total, SHOWN * ROW_HEIGHT + HEADING_HEIGHT))
    .child(v_virtual_list("project-rows", items.length, sizes, (index) => keyOf(items[index]), (range) => items.slice(range.start, range.end).map(item))
      .size_full().track_scroll(scroll)
      .on_item_click((key, cx) => {
        const picked = items.find((one) => one.kind === "project" && keyOf(one) === key);
        if (picked) onRow({ kind: "project", project: picked.project }, cx);
      }))
    .child(Scrollbar.vertical("project-rows").absolute().inset_0());
}

// A row's words: what it is on top, with its chart's words on the right, and under it where it is,
// or why its machine did not answer.
function twoLines(t, top, under, right = null, isTrouble = false) {
  return v_flex().flex_1().min_w(0).gap(2)
    .child(h_flex().min_w(0).gap(8).items_center().text_size(12).text_color(t.foreground)
      .child(top)
      .child(div().flex_1())
      .when(Boolean(right), (el) => el.child(right)))
    .child(div().min_w(0).truncate().text_size(11).text_color(isTrouble ? t.blocked : t.dim).child(under));
}

// Whether a project has a chart, in words: still looking, yes, no, or its machine did not answer.
function chartWords(t, found) {
  if (!found) return div().flex_none().text_size(11).text_color(t.dim).child("Checking…");
  if (found.error) return div().flex_none().text_size(11).text_color(t.blocked).child("Not reached");
  if (!found.map) return div().flex_none().text_size(11).text_color(t.dim).child("No chart");
  return h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.muted)
    .child(div().size(6).rounded_full().bg(t.accent))
    .child("Charted");
}

const divider = (t, id) => div().id(id).flex_none().h(1).mx(8).my(4).bg(t.border);
