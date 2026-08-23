/** Bounded delay for an unavailable broker/database. It prevents a failed poll from becoming a CPU and log storm. */
export function nextReadBackoff(previousMs: number): number { return Math.min(5_000, Math.max(100, previousMs * 2)); }
export function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
