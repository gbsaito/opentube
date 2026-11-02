import { EventEmitter } from "events";
import type { KeyEvent } from "../lib/KeyHandler.js";
import { RGBA, type ColorInput } from "../lib/RGBA.js";
import type { BaseRenderable, Renderable } from "../Renderable.js";
import type { NativeScene } from "../NativeScene.js";
import { type NativeSceneRect, type NativeSceneScrollBarOptions, type SceneNodeHandle } from "../zig.js";
import type { BoxOptions } from "./Box.js";
import type { VNode } from "./composition/vnode.js";
import { type ArrowOptions, type ScrollUnit } from "./ScrollBar.js";
import type { ScrollBoxRenderable } from "./ScrollBox.js";
export type SceneStyleNode = {
    _getSceneHandle(owner: NativeScene): SceneNodeHandle;
};
/** A ScrollBox part: plain geometry and events over the box's native scroll state, not a renderable. */
declare abstract class ScrollBoxPart extends EventEmitter {
    protected readonly box: ScrollBoxRenderable;
    /** `event` is the notification this part emits, if any. */
    constructor(box: ScrollBoxRenderable, event?: string);
    protected abstract rect(): NativeSceneRect;
    /** A part lives as long as its box. */
    get isDestroyed(): boolean;
    get x(): number;
    get y(): number;
    get screenX(): number;
    get screenY(): number;
    get width(): number;
    get height(): number;
    /** @internal Whether a listener needs the box's SCROLL request. */
    abstract _listening(): boolean;
    removeAllListeners(event?: string | symbol): this;
    /** @internal Apply the option keys a part keeps, in order; the others are ignored. */
    _assign(options: object | undefined, keys: readonly string[]): void;
}
/** A fill color, as `backgroundColor` on today's part boxes; transparent paints nothing. */
declare abstract class ScrollBoxFilledPart extends ScrollBoxPart {
    private _backgroundColor?;
    get backgroundColor(): RGBA;
    set backgroundColor(value: ColorInput | null | undefined);
    /** @internal */
    _fill(): RGBA | undefined;
}
/** A part whose size changes reach `"resize"` listeners and `onSizeChange`. */
declare abstract class ScrollBoxSizedPart extends ScrollBoxFilledPart {
    private _onSizeChange?;
    constructor(box: ScrollBoxRenderable);
    get onSizeChange(): (() => void) | undefined;
    set onSizeChange(handler: (() => void) | null | undefined);
    _listening(): boolean;
    /** @internal */
    _emitResize(): void;
}
/** The box's inner rect minus the vertical bar's gutter. */
export declare class ScrollBoxWrapper extends ScrollBoxFilledPart {
    static readonly keys: readonly ["backgroundColor"];
    _listening(): boolean;
    protected rect(): NativeSceneRect;
}
/** The hidden viewport node: the culling window and the children's clip, with the viewport padding in cells. */
export declare class ScrollBoxViewport extends ScrollBoxSizedPart {
    static readonly keys: string[];
    private readonly paddings;
    constructor(box: ScrollBoxRenderable);
    protected rect(): NativeSceneRect;
    private setPadding;
    /** @internal Left, top, right, bottom, resolved like Yoga edges: an edge, then its axis, then all. */
    _edges(): number[];
}
export interface ScrollBoxViewport {
    padding: number | null | undefined;
    paddingX: number | null | undefined;
    paddingY: number | null | undefined;
    get paddingLeft(): number;
    set paddingLeft(value: number | null | undefined);
    get paddingTop(): number;
    set paddingTop(value: number | null | undefined);
    get paddingRight(): number;
    set paddingRight(value: number | null | undefined);
    get paddingBottom(): number;
    set paddingBottom(value: number | null | undefined);
}
/** The hidden content node: the box's children lay out in it, and it moves with the offset. */
export declare class ScrollBoxContent extends ScrollBoxSizedPart {
    static readonly keys: string[];
    private readonly styles;
    constructor(box: ScrollBoxRenderable);
    protected rect(): NativeSceneRect;
    private setStyle;
    /** @internal Whether children lay out in a row, by the direction native was given. */
    get _row(): boolean;
    get viewportCulling(): boolean;
    set viewportCulling(value: boolean);
    add(obj: Renderable | VNode<any, any[]>, index?: number): number;
    insertBefore(obj: Renderable | VNode<any, any[]> | unknown, anchor?: Renderable | unknown): number;
    remove(child: BaseRenderable): void;
    getChildren(): Renderable[];
    getChildrenCount(): number;
    getRenderable(id: string): Renderable | undefined;
    findDescendantById(id: string): Renderable | undefined;
}
/** A scrollbar: its track, thumb and arrows paint natively from the box's scroll state. */
export declare class ScrollBoxBar extends ScrollBoxPart {
    static readonly keys: readonly ["visible", "showArrows", "arrowOptions", "trackOptions", "onChange", "width", "height", "paddingLeft", "paddingTop", "position", "scrollStep"];
    readonly orientation: "vertical" | "horizontal";
    scrollStep: number | undefined | null;
    private readonly axis;
    private policy;
    private _showArrows;
    private _arrowOptions;
    private trackForeground;
    private trackBackground;
    private thickness;
    private gap;
    private overlay;
    private _onChange?;
    constructor(box: ScrollBoxRenderable, orientation: "vertical" | "horizontal");
    protected rect(): NativeSceneRect;
    _listening(): boolean;
    /** @internal */
    _native(): NativeSceneScrollBarOptions;
    /** @internal The start and end arrows as native arrow options. */
    _arrows(): {
        attributes: number;
        foregroundColor: RGBA;
        backgroundColor: RGBA;
        text?: string;
    }[];
    /** @internal */
    _emitChange(position: number): void;
    get visible(): boolean;
    /** True and false hold the bar shown or hidden; a nullish write lets it follow the range again. */
    set visible(value: boolean | null | undefined);
    resetVisibilityControl(): void;
    get onChange(): ((position: number) => void) | undefined;
    set onChange(handler: ((position: number) => void) | null | undefined);
    get showArrows(): boolean;
    set showArrows(value: boolean | null | undefined);
    set arrowOptions(options: Omit<ArrowOptions, "direction"> | null | undefined);
    set trackOptions(options: {
        foregroundColor?: ColorInput;
        backgroundColor?: ColorInput;
    } | null | undefined);
    get width(): number;
    set width(value: number | string | null | undefined);
    get height(): number;
    set height(value: number | string | null | undefined);
    set paddingLeft(value: number | null | undefined);
    set paddingTop(value: number | null | undefined);
    /** An absolute bar overlays the content's edge instead of taking a gutter. */
    set position(value: "absolute" | "relative" | null | undefined);
    private setOption;
    get scrollSize(): number;
    get viewportSize(): number;
    get scrollPosition(): number;
    set scrollPosition(value: number);
    scrollBy(delta: number, unit?: ScrollUnit): void;
    handleKeyPress(key: KeyEvent): boolean;
}
type Edges = "" | "X" | "Y" | "Top" | "Right" | "Bottom" | "Left";
type ContentLayoutKey = "flexDirection" | "flexWrap" | "alignItems" | "justifyContent" | "alignSelf" | "flexGrow" | "flexShrink" | "flexBasis" | `${"min" | "max"}${"Width" | "Height"}` | `${"padding" | "margin"}${Edges}` | "gap" | "rowGap" | "columnGap";
export interface ScrollBoxContent extends ContentLayout {
}
type ContentLayout = {
    [K in ContentLayoutKey]?: BoxOptions[K] | null;
};
export {};
