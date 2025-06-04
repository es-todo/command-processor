export function difference(set1: string[], set2: string[]) {
  const h = Object.fromEntries(set2.map((x) => [x, true]));
  return set1.filter((x) => !h[x]);
}
