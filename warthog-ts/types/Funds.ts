import type { ParsedFunds } from "./ParsedFunds";
import { TokenPrecision } from "./TokenPrecision";
import { MAX_U64 } from "../utils/int";

export class Funds {
    amount: bigint;

    constructor(amount: bigint) {
        this.amount = amount;
    }

    public static parse(fd: ParsedFunds, digits: TokenPrecision): Funds | null {
        if (fd.decimalPlaces > digits.precision) {
            return null;
        }

        const zeros = digits.precision - fd.decimalPlaces;
        let value = fd.val;

        for (let i = 0; i < zeros; i++) {
            if (MAX_U64 / 10n < value) {
                return null;
            }
            value *= 10n;
        }

        return new Funds(value);
    }
}
