export type Platform = "macos" | "windows" | "linux";
export const platform: Platform = /Win/i.test(navigator.userAgent) ? "windows"
  : /Mac/i.test(navigator.userAgent) ? "macos" : "linux";
