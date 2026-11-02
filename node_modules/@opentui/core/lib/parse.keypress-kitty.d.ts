import type { ParsedKey } from "./parse.keypress.js";
export declare const kittyKeyMap: Record<number, string>;
export declare const kittyNamedSingleStrokeKeys: string[];
export declare const printableKeypadText: Record<string, string>;
export declare function parseKittyKeyboard(sequence: string): ParsedKey | null;
