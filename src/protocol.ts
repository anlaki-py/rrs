export const MAX_MESSAGE_SIZE = 1024 * 1024;
const MIN_TERMINAL_DIMENSION = 1;
const MAX_TERMINAL_DIMENSION = 4096;

export interface TerminalSize {
  rows: number;
  cols: number;
}

function isTerminalDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TERMINAL_DIMENSION &&
    value <= MAX_TERMINAL_DIMENSION
  );
}

export function parseResizeMessage(message: string): TerminalSize | undefined {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!isTerminalDimension(candidate.rows) || !isTerminalDimension(candidate.cols)) {
    return undefined;
  }

  return { rows: candidate.rows, cols: candidate.cols };
}

export function encodeResizeMessage(size: TerminalSize): string {
  return JSON.stringify(size);
}
