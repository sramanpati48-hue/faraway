/** Strip internal graph classification blocks leaked into chat markdown. */
export function stripClassificationFromChat(text: string): string {
  if (!text) return "";
  const heading = /(?:^|\n)\s*#{0,3}\s*Classification Data\s*\(Internal\)\s*:?\s*/i;
  const split = text.split(heading);
  let cleaned = split[0] || text;
  cleaned = cleaned.replace(/\[(?:Cognizable|Complex_MLAT|Fraud_Under_10k)\s*:[^\]]*\]/gi, "");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}
