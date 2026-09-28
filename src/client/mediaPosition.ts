const MAX_SECONDS = 24 * 60 * 60;

export function formatMediaPosition(seconds: number, showHours = false): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((showHours || hours > 0 ? safe % 3600 : safe) / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (safe % 60).toString().padStart(2, "0");
  return showHours || hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function parseMediaPosition(input: string): number | null {
  const match = /^(?:(\d{2}):)?(\d{2,4}):([0-5]\d)$/.exec(input.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  if (match[1] && minutes > 59) return null;
  const seconds = hours * 3600 + minutes * 60 + Number(match[3]);
  return seconds <= MAX_SECONDS ? seconds : null;
}
