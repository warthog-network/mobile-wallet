export class TokenPrecision {
    constructor(public precision: number) {
        if (precision < 0 || precision > 18) {
            throw new Error("Invalid precision");
        }
    }
}
