import { MAX_U64 } from "../utils/int";

export class ParsedFunds {
    val: bigint;
    decimalPlaces: number;

    constructor(val: bigint, decimalPlaces: number) {
        this.val = val;
        this.decimalPlaces = decimalPlaces;
    }

    public static parse(s: string): ParsedFunds | null {
        const MAX_DIGITS = 20;

        let str = "";
        let digitsAfterDot = 0;
        let dotFound = false;

        for (const char of s) {
            if (char >= "0" && char <= "9") {
                if (str.length >= MAX_DIGITS) {
                    return null;
                }
                str += char;
                if (dotFound) {
                    digitsAfterDot++;
                }
            } else if (char === ".") {
                if (dotFound) {
                    return null;
                }
                dotFound = true;
            } else {
                return null;
            }
        }

        if (str.length === 0) {
            return null;
        }

        const val = BigInt(str);

        if (val > MAX_U64) {
            return null;
        }

        return new ParsedFunds(val, digitsAfterDot);
    }
}
