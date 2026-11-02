import { type KeyEvent } from "../lib/index.js";
import { type ScrollAcceleration } from "../lib/scroll-acceleration.js";
import type { NativeRenderableIntegration, Renderable } from "../Renderable.js";
import type { MouseEvent } from "../renderer.js";
import type { RenderContext } from "../types.js";
import type { NativeScene } from "../NativeScene.js";
import { type NativeSceneRect, type NativeSceneScrollState } from "../zig.js";
import { BoxRenderable, type BoxOptions } from "./Box.js";
import type { ScrollBarOptions, ScrollUnit } from "./ScrollBar.js";
import { ScrollBoxBar, ScrollBoxContent, ScrollBoxViewport, ScrollBoxWrapper, type SceneStyleNode } from "./ScrollBoxParts.js";
export { ScrollBoxBar, ScrollBoxContent, ScrollBoxViewport, ScrollBoxWrapper } from "./ScrollBoxParts.js";
export interface ScrollBoxOptions extends BoxOptions<ScrollBoxRenderable> {
    rootOptions?: BoxOptions;
    wrapperOptions?: BoxOptions;
    viewportOptions?: BoxOptions;
    contentOptions?: BoxOptions;
    scrollbarOptions?: Omit<ScrollBarOptions, "orientation">;
    verticalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">;
    horizontalScrollbarOptions?: Omit<ScrollBarOptions, "orientation">;
    stickyScroll?: boolean;
    stickyStart?: "bottom" | "top" | "left" | "right";
    scrollX?: boolean;
    scrollY?: boolean;
    scrollAcceleration?: ScrollAcceleration;
    viewportCulling?: boolean;
}
/** A box whose scroll offset, range, sticky edge and scrollbars are native state of its scene node. The
 * `wrapper`, `viewport`, `content` and scrollbar fields are facades over that state, not renderables; the
 * box's children are the scrolled content. */
export declare class ScrollBoxRenderable extends BoxRenderable {
    static readonly nativeIntegration: NativeRenderableIntegration;
    readonly wrapper: ScrollBoxWrapper;
    readonly viewport: ScrollBoxViewport;
    readonly content: ScrollBoxContent;
    readonly horizontalScrollBar: ScrollBoxBar;
    readonly verticalScrollBar: ScrollBoxBar;
    protected static readonly defaultFocusable = true;
    private readonly selectionListener;
    private autoScrollMouseX;
    private autoScrollMouseY;
    private readonly autoScrollThresholdVertical;
    private readonly autoScrollThresholdHorizontal;
    private readonly autoScrollSpeedSlow;
    private readonly autoScrollSpeedMedium;
    private readonly autoScrollSpeedFast;
    private isAutoScrolling;
    private cachedAutoScrollSpeed;
    private autoScrollAccumulatorX;
    private autoScrollAccumulatorY;
    private scrollAccumulatorX;
    private scrollAccumulatorY;
    private _stickyScroll;
    private _stickyStart?;
    private scrollAccel;
    private readonly axes;
    private _viewportCulling;
    private state;
    private stateRevision?;
    private scrollHook;
    private configured;
    private barPress?;
    private layoutCallbacks;
    private anchorToken?;
    get stickyScroll(): boolean;
    set stickyScroll(value: boolean);
    get stickyStart(): "bottom" | "top" | "left" | "right" | undefined;
    set stickyStart(value: "bottom" | "top" | "left" | "right" | undefined);
    /** Native validates the options; a rejected write keeps the accepted values. */
    private setScrollOption;
    /** Whether the box scrolls sideways; on an axis that does not scroll, the content is at most as wide as the viewport. */
    get scrollX(): boolean;
    set scrollX(value: boolean);
    get scrollY(): boolean;
    set scrollY(value: boolean);
    get scrollTop(): number;
    set scrollTop(value: number);
    get scrollLeft(): number;
    set scrollLeft(value: number);
    get scrollWidth(): number;
    get scrollHeight(): number;
    constructor(ctx: RenderContext, options: ScrollBoxOptions);
    /** @internal */
    _applyScrollOptions(): void;
    /** @internal */
    _applyScrollArrows(axis: number): void;
    /** @internal Writes a style of the hidden content node. */
    _setContentStyle(apply: (scene: NativeScene, node: SceneStyleNode) => void): void;
    /** @internal The scroll state of the last prepared frame or explicit scroll. */
    _scrollState(): NativeSceneScrollState;
    /** @internal The box's inner rect without the vertical bar's gutter, as today's wrapper box. */
    _wrapperRect(): NativeSceneRect;
    /** @internal An explicit scroll on one axis; `"change"` reaches listeners at once. With `reapply` it applies again
     * after the next frame's layout. */
    _scrollAxis(axis: number, value: number, relative: boolean, reapply?: boolean): void;
    private commitScroll;
    /** `moved` holds bit 1 for x and bit 2 for y, as native's change bits. */
    private notifyOffsets;
    private listening;
    /** @internal Ask for SCROLL requests only while a part has a listener; `adding` counts one about to be added.
     * Native reports changes from the moment the request is turned on. */
    _refreshScrollHook(adding?: boolean): void;
    /** A SCROLL request: offsets first, as a sticky follow inside a resize hook did, then sizes, then the callbacks
     * waiting for layout. */
    private notifyScroll;
    /** Runs `callback` once in the next frame, after its layout and before it paints: layout reads in it are current,
     * and a scroll it makes shows in that frame. Asked during a frame, it runs in the frame after. It waits while the box
     * is hidden; destroying the box drops it. */
    afterLayout(callback: () => void): void;
    /** Keeps `node`, a descendant, at its place in the viewport through layout changes, over sticky follow, until the
     * returned function runs or the node leaves the box. A scroll moves the place it keeps; a scroll to the end or a later
     * anchor ends it. Release takes effect at once: to keep the place through a change made just before, release in
     * `afterLayout`. */
    anchor(node: Renderable): () => void;
    get primaryAxis(): "row" | "column";
    protected onUpdate(deltaTime: number): void;
    scrollBy(delta: number | {
        x: number;
        y: number;
    }, unit?: ScrollUnit): void;
    /** Scrolls a descendant (by id, or the node) into view now, and again after the next frame's layout. `"nearest"`
     * moves the least; `"start"` and `"end"` put that edge of the node at the viewport's, `inset` cells inside. */
    scrollChildIntoView(child: string | Renderable, options?: {
        align?: "nearest" | "start" | "end";
        inset?: number;
    }): void;
    /** Scrolls now, and again after the next frame's layout, so a position past the current range lands there once the
     * content grows, and one at or past the end (`scrollHeight`, `Infinity`) stays at the end. */
    scrollTo(position: number | {
        x: number;
        y: number;
    }): void;
    /** Takes a wheel step when the box can still move that way. Acceleration and the fractional remainder belong to the
     * box that takes the step; a reversal or an edge clamp drops the remainder. */
    private scrollByWheel;
    protected onMouseEvent(event: MouseEvent): void;
    /** Bar cells hit the box: a press on an arrow scrolls and repeats, one on the track jumps there, and a drag that
     * started on the track or thumb moves the thumb with the pointer. */
    private handleBarMouse;
    private pressArrow;
    /** Thumb geometry is in half cells along the track, as the native slider's. */
    private thumbPointer;
    private pressTrack;
    private dragThumb;
    private endBarPress;
    handleKeyPress(key: KeyEvent): boolean;
    private resetScrollAccumulators;
    startAutoScroll(mouseX: number, mouseY: number): void;
    updateAutoScroll(mouseX: number, mouseY: number): void;
    stopAutoScroll(): void;
    private handleAutoScroll;
    private getAutoScrollDirectionX;
    private getAutoScrollDirectionY;
    private getAutoScrollSpeed;
    set rootOptions(options: ScrollBoxOptions["rootOptions"]);
    set wrapperOptions(options: ScrollBoxOptions["wrapperOptions"]);
    set viewportOptions(options: ScrollBoxOptions["viewportOptions"]);
    set contentOptions(options: ScrollBoxOptions["contentOptions"]);
    set scrollbarOptions(options: ScrollBoxOptions["scrollbarOptions"]);
    set verticalScrollbarOptions(options: ScrollBoxOptions["verticalScrollbarOptions"]);
    set horizontalScrollbarOptions(options: ScrollBoxOptions["horizontalScrollbarOptions"]);
    get scrollAcceleration(): ScrollAcceleration;
    set scrollAcceleration(value: ScrollAcceleration);
    get viewportCulling(): boolean;
    set viewportCulling(value: boolean);
    get overflow(): "hidden";
    /** The box clips like its viewport; other values are ignored. */
    set overflow(_value: unknown);
    protected destroySelf(): void;
}
