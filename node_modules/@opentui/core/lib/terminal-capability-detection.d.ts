/**
 * Terminal capability response detection utilities.
 *
 * Detects various terminal capability response sequences:
 * - DECRPM (DEC Request Mode): ESC[?...;N$y where N is 0,1,2,3,4
 * - XTVersion: ESC P >| ... ESC \
 * - Kitty Graphics: ESC _ G ... ESC \
 * - Kitty Keyboard Query: ESC[?Nu where N is 0,1,2,etc
 * - DA1 (Device Attributes): ESC[?...c
 * - Pixel Resolution: ESC[4;height;widtht
 * - OSC 99 notification capability query response
 * - iTerm2 OSC 1337 feature-reporting response
 * - OSC 7501 program status query response
 */
/**
 * Check if a sequence is a terminal capability response.
 * Returns true if the sequence matches any known capability response pattern.
 */
export declare function isCapabilityResponse(sequence: string): boolean;
/**
 * Check if a cursor position report answers the explicit width or scaled text probe: ESC[1;NR with N >= 2.
 * ESC[1;1R means the cursor did not move, so the terminal has no width support. Shift, Alt and Ctrl+F3 send the
 * same bytes, so only a report the parser classified as one may be checked.
 */
export declare function isExplicitWidthReport(sequence: string): boolean;
/**
 * Check if a sequence is a pixel resolution response.
 * Format: ESC[4;height;widtht
 */
export declare function isPixelResolutionResponse(sequence: string): boolean;
/**
 * Parse pixel resolution from response sequence.
 * Returns { width, height } or null if not a valid resolution response.
 */
export declare function parsePixelResolution(sequence: string): {
    width: number;
    height: number;
} | null;
