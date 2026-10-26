declare module 'qrcode' {
  export function create(
    value: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): {
    modules: {
      size: number;
      get: (column: number, row: number) => boolean | number;
    };
  };
}
