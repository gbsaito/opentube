import { type RenderableOptions, Renderable, type NativeRenderableIntegration } from "../Renderable.js";
import { OptimizedBuffer } from "../buffer.js";
import type { RenderContext } from "../types.js";
export interface FrameBufferOptions extends RenderableOptions<FrameBufferRenderable> {
    width: number;
    height: number;
    /** Blend the buffer's cells into the frame. Without it, the cells are copied, transparent ones too. */
    respectAlpha?: boolean;
}
export declare class FrameBufferRenderable extends Renderable {
    static readonly nativeIntegration: NativeRenderableIntegration;
    frameBuffer: OptimizedBuffer;
    protected respectAlpha: boolean;
    constructor(ctx: RenderContext, options: FrameBufferOptions);
    /** @internal A subclass field can replace the accessor after this constructor returns; refreshHooks() rebinds it. */
    _refreshNativeSceneSurface(): void;
    protected onResize(width: number, height: number): void;
    protected renderSelf(buffer: OptimizedBuffer): void;
}
