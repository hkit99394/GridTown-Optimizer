export function optionalCliNames(names: readonly string[]): string[] | undefined {
  return names.length > 0 ? [...names] : undefined;
}

export function writeCliJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeCliText(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeCliRaw(text: string): void {
  process.stdout.write(text);
}

export function writeCliList(values: readonly string[]): void {
  writeCliText(values.join("\n"));
}

export function writeCliJsonOrText(
  json: boolean,
  jsonValue: unknown | (() => unknown),
  text: string | (() => string)
): void {
  if (json) {
    writeCliJson(typeof jsonValue === "function" ? jsonValue() : jsonValue);
    return;
  }
  writeCliText(typeof text === "function" ? text() : text);
}
