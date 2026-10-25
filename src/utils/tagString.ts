
// ADO stores tags as a semicolon+space separated string: "bug; frontend; P1"
export function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(";").map((t) => t.trim()).filter(Boolean);
}

export function joinTags(tags: string[]): string {
  return tags.join("; ");
}
