// How a drawing is going, as the Chartroom shows it: the steps of a first drawing with the one
// underway, a strip over the chart while it is brought up to date, and how one that ended badly
// ended.
import { div, svg } from "gpui-kit";
import { h_flex, Popup, v_flex } from "gpui-base";
import { dropdownFrame } from "./chart.js";

const ICONS = "mods/workspace-chrome";
// The drawer's steps (draw/draw.js), in its order.
// Each step's share of the whole drawing, for the bar: describing takes the longest.
const STEPS = [
  { step: "scan", label: "Reading the code", about: "The repos, every code file, and what each imports, answers and asks for", share: 0.1 },
  { step: "parts", label: "Finding the app's parts", about: "Claude names the parts of the app and the services they use", isClaude: true, share: 0.25 },
  { step: "describe", label: "Describing every file", about: "A plain name and a line for every file and endpoint, a batch at a time", isClaude: true, share: 0.55 },
  { step: "build", label: "Drawing the chart", about: "Everything put together into the chart, ready to explore", share: 0.1 },
];

// How far the whole drawing is, from 0 to 1: the steps done, and the share of the one underway
// that its count says is done.
export function doneShare(progress) {
  if (progress?.step === "done") return 1;
  const at = STEPS.findIndex((one) => one.step === progress?.step);
  if (at < 0) return 0;
  const before = STEPS.slice(0, at).reduce((sum, one) => sum + one.share, 0);
  const part = progress.total ? Math.min(1, progress.done / progress.total) : 0.15;
  return before + STEPS[at].share * part;
}

// How long ago a moment was, in words.
function sinceWords(startedAt) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(startedAt ?? "")) / 1000));
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

// What a step has got to, in a few words.
export function countOf(progress) {
  if (!progress) return "";
  if (progress.step === "parts") return progress.note || "";
  if (progress.total) return `${progress.done} of ${progress.total} files`;
  return "";
}

// The words for a drawing underway, for the strip over a chart and for the status bar.
export function stepWords(progress) {
  if (progress?.step === "done") return "Finishing";
  const step = STEPS.find((one) => one.step === progress?.step);
  if (!step) return "Starting";
  const count = countOf(progress);
  return count ? `${step.label}: ${count}` : step.label;
}

export function stopButton(t, onStop) {
  return div().id("stop-drawing").flex_none().h(24).px(10).flex().items_center().rounded(6).border_1().border_color(t.border)
    .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Stop drawing (s)")
    .on_click((_e, cx) => onStop(cx)).child("Stop");
}

// A first drawing: each step, done, underway or to come, and a way to stop.
export function firstDrawing({ t, name, progress, onStop }) {
  const at = progress?.step === "done" ? STEPS.length : Math.max(0, STEPS.findIndex((one) => one.step === progress?.step));
  const share = doneShare(progress);
  const row = (one, index) => {
    const isDone = index < at;
    const isNow = index === at;
    const mark = isDone ? svg(`${ICONS}/check.svg`).size(13).text_color(t.accent)
      : isNow ? svg(`${ICONS}/spinner.svg`).size(13).text_color(t.working).spin(900)
        : div().size(6).rounded_full().bg(t.border);
    return h_flex().flex_none().px(10).py(8).gap(12).items_start().rounded(8)
      .when(isNow, (el) => el.bg(t.background).border_1().border_color(t.border))
      .child(div().w(22).h(22).flex_none().rounded_full().flex().items_center().justify_center()
        .bg(isDone ? thinOf(t.accent, "26") : isNow ? t.raised : t.chrome).child(mark))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_none().text_size(13).font_medium().text_color(isDone || isNow ? t.foreground : t.dim).child(one.label))
          .when(Boolean(one.isClaude), (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child("Claude")))
          .child(div().flex_1())
          .when(isNow, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.muted).child(countOf(progress)))))
        .child(div().text_size(11.5).line_height("16px").text_color(t.dim).child(one.about)));
  };
  // A card in the middle of the area: what is drawn, how far, each step, and a way to stop.
  return v_flex().flex_1().min_h(0).items_center().justify_center().px(16).py(16)
    .child(v_flex().w_full().max_w(520).p(18).gap(14).rounded(12).border_1().border_color(t.border).bg(t.chrome)
      .child(h_flex().gap(12).items_center()
        .child(div().size(40).flex_none().rounded(10).bg(thinOf(t.accent, "22")).flex().items_center().justify_center()
          .child(svg(`${ICONS}/layers.svg`).size(20).text_color(t.accent)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(15).font_semibold().child(`Drawing the chart of ${name}`))
          .child(div().text_size(11.5).text_color(t.dim).child("Your own Claude reads the code. You can close the panel meanwhile.")))
        .child(stopButton(t, onStop)))
      .child(v_flex().gap(6)
        .child(h_flex().text_size(11).text_color(t.dim)
          .child(div().flex_1().child(`${Math.round(share * 100)}%`))
          .when(Boolean(progress?.startedAt), (el) => el.child(div().flex_none().child(`running ${sinceWords(progress.startedAt)}`))))
        .child(div().h(6).w_full().rounded_full().bg(t.border).overflow_hidden()
          .child(div().h_full().w(`${Math.max(2, share * 100)}%`).rounded_full().bg(t.accent).transition("width", { duration: 400, easing: "ease-out" }))))
      .child(v_flex().gap(4).children(STEPS.map(row))));
}

// A colour, thinly: hex with an alpha.
const thinOf = (color, alpha) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color);

// A strip over the chart while it is brought up to date, or drawn again from scratch.
export function updateStrip({ t, progress, onStop }) {
  const doing = progress?.isUpdate === false ? "Drawing from scratch" : "Updating";
  return h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
    .child(svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`${doing} · ${stepWords(progress)}`))
    .child(stopButton(t, onStop));
}

// The ways to bring the Chartroom's own chart up to date, in the menu beside the header's Update.
export const DRAW_WAYS = [
  { id: "update", label: "Update", about: "Only what changed since the chart", key: "u" },
  { id: "again", label: "Draw again from scratch…", about: "The parts and every file, anew", key: "⇧U" },
];

// The chevron beside the header's Update, and under it while open the menu of DRAW_WAYS. The open
// state is the panel's own, as the ask bar's model list: a click on the chevron opens it, Up, Down,
// Enter and Escape are the menu's, and a press outside closes it and goes no further, so a press on
// the chevron closes it rather than opening it again.
export function drawMenu({ t, isOpen, cursor, list, onOpen, onPick, onKey }) {
  const trigger = div().id("draw-ways").flex_none().h_full().px(5).flex().items_center().rounded_r(6).border_l(1).border_color(t.border)
    .text_color(isOpen ? t.foreground : t.muted).when(isOpen, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover).text_color(t.foreground))
    .role("combo_box").cursor_pointer().tooltip("More ways to draw the chart")
    .on_click((_e, cx) => onOpen(true, cx))
    .child(svg(`${ICONS}/chevron-down.svg`).size(12));
  const row = (way, index) => h_flex().id(`draw-way-${way.id}`).h(40).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
    .role("list_box_option").when(index === cursor, (el) => el.bg(t.selected).aria_active_descendant()).hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onPick(way.id, cx))
    .child(div().w(14).flex_none().flex().justify_center().text_color(t.muted)
      .child(way.id === "update" ? div().text_size(14).child("↻") : svg(`${ICONS}/layers.svg`).size(13)))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_size(12).text_color(t.foreground).child(way.label))
      .child(div().truncate().text_size(11).text_color(t.dim).child(way.about)))
    .child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.muted).child(way.key));
  const menu = dropdownFrame(t, "draw-ways-menu", 260).track_focus(list)
    .on_key_down((e, cx) => onKey(e, cx))
    .on_mouse_down_out((_e, cx) => {
      cx.stop_propagation();
      onOpen(false, cx);
    })
    .children(DRAW_WAYS.map(row));
  return Popup.new("draw-ways-list", trigger).h_full().anchor("top_right").when(isOpen, (el) => el.content(menu));
}

// Under the trail before the Chartroom's own chart is drawn again from scratch: what that asks of
// the person's Claude, and a way to go on or not.
export function againStrip({ t, words, onDraw, onCancel }) {
  const action = (id, label, isSolid, tip, act) => div().id(id).flex_none().h(24).px(10).flex().items_center().rounded(6).text_size(12).cursor_pointer()
    .when(isSolid, (el) => el.bg(t.solid).text_color(t.solid_foreground))
    .when(!isSolid, (el) => el.border_1().border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
    .tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => act(cx)).child(label);
  // The buttons under the words, so the words keep the width at the panel's narrowest.
  return h_flex().flex_none().px(14).py(9).gap(8).items_start().border_b(1).border_color(t.border).text_size(12)
    .child(div().mt(5).size(7).flex_none().rounded_full().bg(t.accent))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().font_medium().text_color(t.foreground).child(words.ask))
      .child(div().text_size(11.5).line_height("16px").text_color(t.muted).child(words.detail))
      .child(h_flex().mt(6).gap(6).items_center()
        .child(action("draw-again-yes", "Draw again", true, "Your Claude draws the chart anew", onDraw))
        .child(action("draw-again-no", "Not now", false, "Keep the chart as it is (esc)", onCancel))));
}

// Under the trail when the code moved on since the chart: how far, and a way to bring it up to date.
export function changedStrip({ t, changed, isOwn, onUpdate }) {
  const parts = [changed.commits ? `${changed.commits} commit${changed.commits === 1 ? "" : "s"}` : "", changed.files ? `${changed.files} file${changed.files === 1 ? "" : "s"} not committed` : ""].filter(Boolean);
  return h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
    .child(div().size(7).flex_none().rounded_full().bg(t.accent))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`The code moved on since this chart: ${parts.join(", ")}`))
    .child(div().id("update-chart").flex_none().h(24).px(10).flex().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12)
      .cursor_pointer().tooltip(isOwn ? "Your Claude reads only what changed (u)" : "Your Claude draws the Chartroom's own chart (u)")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onUpdate(cx)).child(isOwn ? "Update the chart" : "Draw it"));
}

// How the last drawing ended, when it did not end with a chart: in words, or nothing. One that
// ended before it could say so speaks through the end of its log.
export function endedWords(progress, log = "") {
  if (progress?.step === "failed") return `The last drawing failed: ${progress.error || log || "for no reason it gave"}`;
  if (progress?.step === "stopped") return "The last drawing was stopped.";
  if (!progress && log) return `The last drawing ended before it began: ${log}`;
  return "";
}
