// The Chartroom's list of projects to chart, drawn as the Changes panel draws its files: the
// focused space's project to follow, every space's project, and any folder picked by hand.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

const ICONS = "mods/workspace-chrome";
const ROW_HEIGHT = 30;

// A folder as the spaces sidebar shows one: home as ~.
const shortFolder = (folder, home) => (home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder);

// The rows in the order the keys move through them: following the focus, each project, choosing.
export function pickerRows(projects) {
  return [{ kind: "follow" }, ...projects.map((project) => ({ kind: "project", project })), { kind: "choose" }];
}

export function projectList({ t, rows, cursor, charted, pinned, focusedFolder, home, onRow }) {
  const isFollowing = !pinned;
  const row = (item, index) => {
    const isCurrent = item.kind === "follow" ? isFollowing : item.kind === "project" && pinned?.folder === item.project.folder && (pinned.on ?? null) === item.project.on;
    const line = h_flex().id(`project-${index}`).h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .when(index === cursor, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => onRow(item, cx));
    const check = isCurrent ? svg(`${ICONS}/check.svg`).size(13).flex_none().text_color(t.accent) : div().w(13).flex_none();
    if (item.kind === "follow") {
      return line.child(svg(`${ICONS}/layers.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_none().child("Follow the focused space"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(focusedFolder ? shortFolder(focusedFolder, home) : ""))
        .child(check);
    }
    if (item.kind === "choose") {
      return line.child(svg(`${ICONS}/folder-plus.svg`).size(14).flex_none().text_color(t.muted)).child(div().flex_1().text_color(t.muted).child("Choose a folder…"));
    }
    const { project } = item;
    return line.child(svg(`${ICONS}/folder.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(150).truncate().child(project.label))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`${project.on ? `${project.on}:` : ""}${shortFolder(project.folder, home)}`))
      .child(chartBadge(t, charted.get(project.key), project.key))
      .child(check);
  };
  return v_flex().id("projects").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(1)
    .child(div().px(8).pb(4).text_size(11).font_medium().text_color(t.dim).child("Chart a project"))
    .children(rows.map(row));
}

// Whether a project has a chart: still looking, yes, no, or its machine did not answer.
function chartBadge(t, found, key) {
  if (!found) return svg(`${ICONS}/spinner.svg`).size(11).flex_none().text_color(t.dim).spin(900);
  if (found.error) return div().id(`unreachable-${key}`).flex_none().text_size(10.5).text_color(t.blocked).tooltip(found.error).child("not reached");
  if (!found.map) return div().flex_none().text_size(10.5).text_color(t.dim).child("no chart");
  return div().flex_none().px(5).rounded(4).bg(/^#[0-9a-f]{6}$/i.test(t.accent) ? `${t.accent}26` : t.raised).text_size(10.5).font_semibold().text_color(t.accent).child("chart");
}
