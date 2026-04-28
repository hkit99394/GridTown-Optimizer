export function parseNameList(value: string, label: string): string[] {
  const names = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (names.length === 0) {
    throw new Error(`Expected at least one ${label}.`);
  }
  return names;
}

export function readNamedOptionValue(argv: readonly string[], longName: string): string | undefined {
  const flag = `--${longName}`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index].trim();
    const inlineValue = readInlineOptionValue(arg, longName);
    if (inlineValue !== undefined) return inlineValue;
    if (arg === flag) return argv[index + 1]?.trim();
  }
  return undefined;
}

export function readInlineOptionValue(arg: string, longName: string): string | undefined {
  const prefix = `--${longName}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined;
}

export function parseNumberList(value: string, label: string): number[] {
  const parts = value
    .split(",")
    .map((entry) => entry.trim());
  const numbers = parts.map((entry) => Number(entry));
  if (parts.length === 0 || parts.some((entry) => entry.length === 0) || numbers.some((number) => !Number.isFinite(number))) {
    throw new Error(`Expected ${label} to contain only finite numbers.`);
  }
  return numbers;
}

export function parsePositiveInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return number;
}

export function parseNonNegativeInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return number;
}

export function parsePositiveNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Expected ${label} to be a positive finite number.`);
  }
  return number;
}
