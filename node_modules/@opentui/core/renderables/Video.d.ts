import type { OptimizedBuffer } from "../buffer.js";
import { Renderable, type NativeRenderableIntegration, type RenderableOptions } from "../Renderable.js";
import type { RenderContext } from "../types.js";
import type { ExtractOptions } from "../image.js";
import { type ImageFit } from "./Image.js";
export interface VideoMetadata {
    width: number;
    height: number;
    fps: number;
    duration: number;
    hasAudio: boolean;
}
export interface VideoRenderableOptions extends RenderableOptions<VideoRenderable> {
    /** Path of an MP4 (H.264/AAC) file. */
    source?: string;
    fit?: ImageFit;
    /** The region of the source to show, in source pixels; `fit` applies to it, and only the region is scaled. */
    crop?: ExtractOptions;
    /** Plays each source once it opens. */
    autoplay?: boolean;
    loop?: boolean;
    /** Opens the audio track. With false, playback opens no audio device and follows the wall clock. Defaults to true. */
    audio?: boolean;
    muted?: boolean;
    volume?: number;
    /** Positive values show frames earlier relative to the audio. */
    avSyncOffsetMs?: number;
    /** Upper bound of the presentation rate, an integer from 1 to 120. Defaults to 30. */
    maxFps?: number;
    onReady?: (metadata: VideoMetadata) => void;
    onError?: (error: Error) => void;
    onEnd?: () => void;
    onPlay?: () => void;
    onPause?: () => void;
    onSeek?: (time: number) => void;
    onTimeUpdate?: (time: number) => void;
}
/**
 * Plays a video file in a native scene node. Decoding, the media clock, and frame drawing stay native;
 * this wrapper sends control calls and reads playback state on the animation clock while playing.
 */
export declare class VideoRenderable extends Renderable {
    static readonly nativeIntegration: NativeRenderableIntegration;
    private _source;
    private _fit;
    private _crop;
    private _loop;
    private _audio;
    private _muted;
    private _volume;
    private _avSyncOffsetMs;
    private _maxFps;
    private _autoplay;
    private _metadata;
    private _playRequested;
    private stopTick?;
    private _opens;
    onReady?: (metadata: VideoMetadata) => void;
    onError?: (error: Error) => void;
    onEnd?: () => void;
    onPlay?: () => void;
    onPause?: () => void;
    onSeek?: (time: number) => void;
    onTimeUpdate?: (time: number) => void;
    constructor(ctx: RenderContext, options: VideoRenderableOptions);
    get source(): string | undefined;
    /** Opens a new source; playback intent carries over to it. */
    set source(value: string | null | undefined);
    private open;
    get fit(): ImageFit;
    set fit(value: ImageFit | null | undefined);
    get crop(): ExtractOptions | undefined;
    /** A crop that is not whole pixels, or lies outside the open source, reports through onError and keeps the previous one. */
    set crop(value: ExtractOptions | null | undefined);
    get loop(): boolean;
    set loop(value: boolean | null | undefined);
    get audio(): boolean;
    set audio(value: boolean | null | undefined);
    get muted(): boolean;
    set muted(value: boolean | null | undefined);
    get volume(): number;
    set volume(value: number | null | undefined);
    get avSyncOffsetMs(): number;
    set avSyncOffsetMs(value: number | null | undefined);
    get maxFps(): number;
    set maxFps(value: number | null | undefined);
    /** Applies to the next source that opens, and to an open source that has not started yet. */
    get autoplay(): boolean;
    set autoplay(value: boolean | null | undefined);
    get ready(): boolean;
    get videoMetadata(): Readonly<VideoMetadata> | null;
    get playing(): boolean;
    get paused(): boolean;
    get ended(): boolean;
    get duration(): number;
    get durationMs(): number;
    get currentTime(): number;
    /** Seeks; a nullish write is ignored. */
    set currentTime(value: number | null | undefined);
    /** Adaptive quality tier: 0 decodes at full size; higher tiers decode smaller while output cannot keep up. */
    get qualityTier(): number;
    get currentTimeMs(): number;
    play(): void;
    resume(): void;
    pause(): void;
    toggle(): void;
    seek(time: number): void;
    seekBy(delta: number): void;
    seekToMs(milliseconds: number): void;
    protected createFrameBuffer(): void;
    protected renderSelf(_buffer: OptimizedBuffer): void;
    private poll;
    private native;
    private readState;
    private failed;
    private errorDetail;
    private applyOption;
    private control;
    private syncPlayback;
    private setNativeSceneVideo;
    private acceptCrop;
    private startRequested;
    private afterOpen;
    private reportError;
    protected destroySelf(): void;
}
