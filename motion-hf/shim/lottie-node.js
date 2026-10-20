// Node (media planner) stand-in for @remotion/lottie: lottie-web needs a DOM to
// load; the planner only needs the tree's media, not the animation.
import { h } from "preact";
export const Lottie = ({ style, className }) => h("div", { className, style });
