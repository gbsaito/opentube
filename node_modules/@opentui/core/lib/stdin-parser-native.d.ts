import { type NativeContextHandle, type RenderLib, type SessionHandle } from "../zig.js";
import type { StdinEvent, StdinParserOptions, StdinParserProtocolContext } from "./stdin-parser.js";
export interface NativeInputSession {
    lib: RenderLib;
    context: NativeContextHandle;
    session: SessionHandle;
}
export interface NativeStdinParserOptions extends Pick<StdinParserOptions, "armTimeouts" | "onTimeoutFlush" | "protocolContext" | "clock"> {
    /** Parse through this Session's input parser. Without one, the parser owns a private Context and Session. */
    session?: NativeInputSession;
}
/**
 * Same surface as StdinParser for renderer.ts, without the hooks that coordinated
 * parser and renderer state: a deferred reply has no deadline, so CPR aborts and
 * pixel queries need no special handling; suspension needs only suspend and resume.
 */
export declare class NativeStdinParser {
    private readonly lib;
    private readonly context;
    private readonly session;
    private readonly ownsContext;
    private readonly records;
    private readonly words;
    private readonly halves;
    private readonly payload;
    private readonly events;
    private readonly clock;
    private readonly armTimeouts;
    private readonly onTimeoutFlush;
    private protocolContext;
    private appliedExpectations;
    private timeoutId;
    private deadlineNs;
    private lastNs;
    private paste;
    private suspended;
    private sessionGone;
    private destroyed;
    constructor(options?: NativeStdinParserOptions);
    updateProtocolContext(patch: Partial<StdinParserProtocolContext>): void;
    /** A bracketed paste has started and not yet ended. */
    get pasting(): boolean;
    push(data: Uint8Array): void;
    read(): StdinEvent | null;
    drain(onEvent: (event: StdinEvent) => void): void;
    /** Resolves a partial unit whose deadline has passed at `nowMsValue`. */
    flushTimeout(nowMsValue?: number): void;
    /** Stops input time and the timer: a unit pending at suspension can still complete on resume. */
    suspend(): void;
    /**
     * Call after feeding the input drained on resume. Input sent before suspension has
     * arrived, so a unit still pending is stale (another process may have read its rest)
     * and is dropped. Only the prefix of a reply the host still awaits keeps waiting.
     */
    resume(): void;
    reset(): void;
    destroy(): void;
    private ensureAlive;
    /** Runs a native call. A Session or Context that closed, failed, or was destroyed ends parsing quietly. */
    private native;
    private destroyContext;
    private applyExpectations;
    private toNs;
    private nowNs;
    private feed;
    private reconcileTimeout;
    private clearTimeout;
    private span;
    private translate;
}
/**
 * Pairs the events of the delivering parser with the events of a parser that only
 * sees the same input (OTUI_NATIVE_INPUT_SHADOW) and logs one line per difference.
 * Events pair in order, so the parsers' separate timers cannot misalign them. After
 * a difference, pairing resumes once each side has reported its next event.
 */
export declare class StdinShadowComparator {
    private readonly primaryName;
    private readonly log;
    private readonly delivered;
    private readonly shadowed;
    constructor(primaryName: "legacy" | "native", log: (line: string) => void);
    primary(event: StdinEvent): void;
    shadow(event: StdinEvent): void;
    /** Reports every event still unpaired. Call when both parsers have stopped. */
    flush(): void;
    private queue;
    private pair;
    private report;
}
