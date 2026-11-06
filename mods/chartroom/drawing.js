// How a drawing is going, as the Chartroom shows it: the steps of a first drawing with the one
// underway, a strip over the chart while it is brought up to date, and how one that ended badly
// ended.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

const ICONS = "mods/workspace-chrome";
// The drawer's steps (draw/draw.js), in its order.
const STEPS = [
  { step: "scan", label: "Reading the code" },
  { step: "parts", label: "Finding the app's parts", isClaude: true },
  { step: "describe", label: "Describing every file", isClaude: true },
  { step: "build", label: "Drawing the chart" },
];

// What a step has got to, in a few words.
export function countOf(progress) {
  if (!progress) return "";
  if (progress.step === "parts") return progress.note || "";
  if (progress.total) return `${progress.done} of ${progress.total} files`;
  return "";
}

// The words for a drawing underway, for the strip over a chart and for the status bar.
export function stepWords(progress) {
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
  const at = Math.max(0, STEPS.findIndex((one) => one.step === progress?.step));
  const row = (one, index) => {
    const isDone = index < at;
    const isNow = index === at;
    const mark = isDone ? svg(`${ICONS}/check.svg`).size(13).text_color(t.accent)
      : isNow ? svg(`${ICONS}/spinner.svg`).size(13).text_color(t.working).spin(900)
        : div().size(6).rounded_full().bg(t.border);
    return h_flex().h(28).flex_none().gap(10).items_center()
      .child(div().w(14).flex_none().flex().items_center().justify_center().child(mark))
      .child(div().flex_none().text_color(isDone || isNow ? t.foreground : t.dim).child(one.label))
      .when(Boolean(one.isClaude), (el) => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child("Claude")))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(isNow ? countOf(progress) : ""));
  };
  return v_flex().flex_1().min_h(0).px(16).py(14).gap(4)
    .child(h_flex().gap(8).items_center().pb(6)
      .child(div().flex_1().min_w(0).truncate().font_medium().child(`Drawing the chart of ${name}`))
      .child(stopButton(t, onStop)))
    .children(STEPS.map(row))
    .child(div().pt(10).text_size(11.5).line_height("16px").text_color(t.dim)
      .child("Your own Claude reads the code in the background, on your subscription. The chart shows here as soon as it is done, and the panel can close meanwhile."));
}

// A strip over the chart while it is brought up to date.
export function updateStrip({ t, progress, onStop }) {
  return h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
    .child(svg(`${ICONS}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900))
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`Updating · ${stepWords(progress)}`))
    .child(stopButton(t, onStop));
}

// How the last drawing ended, when it did not end with a chart: in words, or nothing.
export function endedWords(progress) {
  if (progress?.step === "failed") return `The last drawing failed: ${progress.error ?? "for no reason it gave"}`;
  if (progress?.step === "stopped") return "The last drawing was stopped.";
  return "";
}
