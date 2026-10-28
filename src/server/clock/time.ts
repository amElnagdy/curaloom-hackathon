// Simulated time (ADR-004): a day number and a minute of that day. Pure, so the UI can format
// and compare the `sim_ts` strings that trace events and messages carry.

export type SimTime = { day: number; minute: number };
export type Duration = { days?: number; minutes?: number };

export const MINUTES_PER_DAY = 24 * 60;
// A jump to a day lands at the start of the learner's day; day 0 is the seed's first day.
export const DAY_START = 9 * 60;
export const DAY_ZERO: SimTime = { day: 0, minute: DAY_START };

export function startOfDay(day: number): SimTime {
  return { day, minute: DAY_START };
}

export function toMinutes(t: SimTime): number {
  return t.day * MINUTES_PER_DAY + t.minute;
}

export function fromMinutes(total: number): SimTime {
  return { day: Math.floor(total / MINUTES_PER_DAY), minute: total % MINUTES_PER_DAY };
}

export function later(t: SimTime, { days = 0, minutes = 0 }: Duration): SimTime {
  return fromMinutes(toMinutes(t) + days * MINUTES_PER_DAY + minutes);
}

export function compareSimTime(a: SimTime, b: SimTime): number {
  return toMinutes(a) - toMinutes(b);
}

// "19:00" for minute 1140.
export function hhmm(minute: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

// Minute of day for "HH:MM", e.g. a learner's quiet hours.
export function minuteOfDay(text: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) throw new Error(`Expected a time of day as HH:MM; got "${text}"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// "day 2 19:00": the form trace events, messages and the HTTP API use.
export function formatSimTime(t: SimTime): string {
  return `day ${t.day} ${hhmm(t.minute)}`;
}

export function parseSimTime(text: string): SimTime {
  const match = /^day (\d+) (\d\d:\d\d)$/.exec(text);
  if (!match?.[2])
    throw new Error(`Expected a simulated time such as "day 2 19:00"; got "${text}"`);
  return { day: Number(match[1]), minute: minuteOfDay(match[2]) };
}
