export function safeIsoString(value: Date): string | null {
  try {
    const time = value.getTime();
    if (Number.isNaN(time)) return null;
    return value.toISOString();
  } catch {
    return null;
  }
}

export function isDateLike(value: unknown): value is Date {
  return (
    value instanceof Date ||
    Object.prototype.toString.call(value) === "[object Date]"
  );
}
