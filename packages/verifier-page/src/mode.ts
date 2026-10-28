/**
 * VERIFIER_PAGE_MODE is read once, at build time. The share page is on only
 * when the value is exactly the string "true": "TRUE", "1", " true", "yes",
 * empty and unset all leave the plain paste verifier in place.
 */
export function isShareMode(value: string | undefined): boolean {
  return value === "true";
}
