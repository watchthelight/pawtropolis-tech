declare module "culori" {
  interface Oklch {
    mode: "oklch";
    l: number;
    c: number;
    h: number;
    alpha?: number;
  }

  export function formatHex(color: Oklch | object): string | undefined;
  export function clampChroma(color: Oklch | object, mode?: string): Oklch;
}
