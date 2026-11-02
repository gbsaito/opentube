import type { ScrollInfo } from "./parse.mouse.js";
type Node = {
    parent: Node | null;
};
/** The axis direction of a wheel step: Shift turns vertical steps sideways and sideways steps vertical. */
export declare function wheelDirection(event: {
    scroll?: ScrollInfo;
    modifiers?: {
        shift: boolean;
    };
}): ScrollInfo["direction"] | undefined;
/** A wheel step belongs to the innermost scroller on its path that can still move that way. Runs `scroll` unless a
 * scroller inside `scroller` already took this event; `scroll` returns whether `scroller` takes it. Listeners further
 * out still see the event; only scrolling stops. */
export declare function scrollOnce(event: object, scroller: Node, scroll: () => boolean): void;
export {};
