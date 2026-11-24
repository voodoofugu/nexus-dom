export const TEXT_START = "nxs:t";
export const TEXT_END = "nxs:/";

export const hydrationText = (value: string) =>
  `<!--${TEXT_START}-->${value}<!--${TEXT_END}-->`;
