/**
 * Small lexicon-based tone scorer for headlines and social posts. It is a
 * heuristic, not a language model: it counts positive and negative words,
 * flips a word after a negation, and squashes the balance into [-1, 1].
 */

const POSITIVE = new Set(
  (
    "gain gains gained surge surges surged rally rallies rallied rise rises rising rose jump jumps jumped soar soars " +
    "soared boom booming growth grow grows growing record strong stronger strongest recovery recover recovers rebound " +
    "rebounds beat beats win wins won victory success successful agree agrees agreement deal deals peace ceasefire " +
    "breakthrough approve approved approves boost boosts improve improved improves improvement optimism optimistic " +
    "bullish upgrade upgraded profit profits profitable lead leads safe safer hope hopeful support supports supported " +
    "praise praised celebrate celebrates launch launches progress resolve resolved relief stable stability adoption " +
    "milestone upbeat thrive thrives best better good great love happy excellent positive rich prosper welcome " +
    "welcomed cooperation partnership growth expands expansion cured cure saved rescue rescued"
  ).split(" ")
);

const NEGATIVE = new Set(
  (
    "fall falls fell falling drop drops dropped plunge plunges plunged crash crashes crashed slump slumps slumped " +
    "decline declines declined loss losses lose loses lost weak weaker weakest fear fears feared crisis war wars " +
    "attack attacks attacked killed kill kills dead death deaths dies died collapse collapses collapsed ban bans " +
    "banned sanction sanctions tariff tariffs recession inflation default defaults bankrupt bankruptcy fraud scam " +
    "hack hacked breach threat threats threaten threatens warn warns warning warned protest protests riot riots " +
    "unrest strike strikes layoff layoffs shortage panic selloff bearish downgrade downgraded risk risks risky " +
    "fail fails failed failure conflict missile missiles bomb bombing bombs explosion disaster flood floods " +
    "wildfire wildfires earthquake storm storms hurricane cyclone outbreak virus lawsuit sued arrest arrested " +
    "charged scandal corruption resign resigns resigned shutdown deficit debt bad worse worst terrible hate sad " +
    "negative tension tensions escalate escalates escalation invasion hostage hostages evacuate evacuated evacuation " +
    "toll injured victims famine poverty crime violence violent terror terrorist drought"
  ).split(" ")
);

const NEGATIONS = new Set(["not", "no", "never", "without", "hardly", "cannot", "cant", "dont", "doesnt", "isnt", "wont", "didnt"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z]+/)
    .filter((token) => token.length > 0);
}

export function scoreTone(text: string): number {
  const tokens = tokenize(text);
  let balance = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let weight = 0;
    if (POSITIVE.has(token)) weight = 1;
    else if (NEGATIVE.has(token)) weight = -1;
    if (weight === 0) continue;
    const negated = NEGATIONS.has(tokens[i - 1]) || NEGATIONS.has(tokens[i - 2]);
    balance += negated ? -weight : weight;
  }
  return Number(Math.tanh(balance / 2).toFixed(4));
}

/** Strips HTML tags and decodes the common entities found in feeds and posts. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}
