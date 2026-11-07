// The Chartroom's list of projects to chart, in a dropdown under the project button: the focused
// space's project to follow, every space's project, and any folder picked by hand.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { dropdownFrame } from "./chart.js";

const ICONS = "mods/workspace-chrome";
const ROW_HEIGHT = 40;
const ONE_LINE = 32;

// A folder as the spaces sidebar shows one: home as ~.
const shortFolder = (folder, home) => (home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder);

// The rows in the order the keys move through them: following the focus, each project, choosing.
export function pickerRows(projects) {
  return [{ kind: "follow" }, ...projects.map((project) => ({ kind: "project", project })), { kind: "choose" }];
}

// The dropdown: under a small heading, a row of two lines for following the focus and for each
// project (its name, its chart's badge and a check on the one charted, then its folder), and
// "Choose a folder…", the three kinds set apart by thin lines. A press outside it closes it, and goes
// no further, so a press on the project button closes it rather than opening it again.
export function projectList({ t, rows, cursor, charted, pinned, focusedFolder, home, width, onRow, onClose }) {
  const isFollowing = !pinned;
  const icon = (name) => svg(`${ICONS}/${name}.svg`).size(14).flex_none().text_color(t.muted);
  const lines = (name, under, badge) => v_flex().flex_1().min_w(0).gap(2)
    .child(h_flex().min_w(0).gap(8).items_center()
      .child(div().flex_shrink_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name))
      .child(div().flex_1())
      .when(Boolean(badge), (el) => el.child(badge)))
    .when(Boolean(under), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(under)));
  const row = (item, index) => {
    const isCurrent = item.kind === "follow" ? isFollowing : item.kind === "project" && pinned?.folder === item.project.folder && (pinned.on ?? null) === item.project.on;
    const line = h_flex().id(`project-${index}`).h(item.kind === "choose" ? ONE_LINE : ROW_HEIGHT).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
      .role("list_box_option").when(index === cursor, (el) => el.bg(t.selected).aria_active_descendant()).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => onRow(item, cx));
    const check = isCurrent ? svg(`${ICONS}/check.svg`).size(13).flex_none().text_color(t.accent) : div().w(13).flex_none();
    if (item.kind === "follow") return line.child(icon("layers")).child(lines("Follow the focused space", focusedFolder ? shortFolder(focusedFolder, home) : "")).child(check);
    if (item.kind === "choose") return line.child(icon("folder-plus")).child(div().flex_1().text_size(12).text_color(t.muted).child("Choose a folder…"));
    const { project } = item;
    const folder = `${project.on ? `${project.on}:` : ""}${shortFolder(project.folder, home)}`;
    return line.child(icon("folder")).child(lines(project.label, folder, chartBadge(t, charted.get(project.key), project.key))).child(check);
  };
  const divider = (id) => div().id(id).flex_none().h(1).mx(8).my(3).bg(t.border);
  const projects = rows.slice(1, -1);
  return dropdownFrame(t, "projects", width).max_h(ROW_HEIGHT * 9 + 60).overflow_y_scrollbar()
    .on_mouse_down_out((_e, cx) => {
      cx.stop_propagation();
      onClose(cx);
    })
    .child(div().px(8).pt(2).pb(2).text_size(11).font_medium().text_color(t.dim).child("Chart a project"))
    .child(row(rows[0], 0))
    .child(divider("projects-above"))
    .children(projects.map((item, index) => row(item, index + 1)))
    .when(projects.length > 0, (el) => el.child(divider("projects-below")))
    .child(row(rows.at(-1), rows.length - 1));
}

// Whether a project has a chart: still looking, yes, no, or its machine did not answer.
function chartBadge(t, found, key) {
  if (!found) return svg(`${ICONS}/spinner.svg`).size(11).flex_none().text_color(t.dim).spin(900);
  if (found.error) return div().id(`unreachable-${key}`).flex_none().text_size(10.5).text_color(t.blocked).tooltip(found.error).child("not reached");
  if (!found.map) return div().flex_none().text_size(10.5).text_color(t.dim).child("no chart");
  return div().flex_none().px(5).rounded(4).bg(/^#[0-9a-f]{6}$/i.test(t.accent) ? `${t.accent}26` : t.raised).text_size(10.5).font_semibold().text_color(t.accent).child("chart");
}
