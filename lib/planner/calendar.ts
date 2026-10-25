// Festival dates that applicants mention in notes (SPEC §7.1). Marked "verify": dates should be
// checked against the official calendar before relying on them.

export interface Festival {
  name: string;
  date: string;
  verify: true;
}

export const FESTIVALS: readonly Festival[] = [
  { name: "Diwali", date: "2026-11-08", verify: true },
  { name: "New Year", date: "2027-01-01", verify: true },
  { name: "Sankranti", date: "2027-01-14", verify: true },
];

/** The next occurrence on or after today of a festival named in the notes, if we know its date. */
export function festivalDate(name: string | null, today: string): Festival | null {
  if (!name) return null;
  return FESTIVALS.find((f) => f.name === name && f.date >= today) ?? null;
}
