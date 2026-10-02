export function createStableId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mulwsfe4-${Math.random().toString(36).slice(2)}`;
}
