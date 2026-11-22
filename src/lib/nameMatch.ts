/**
 * Is this email address (display name + mailbox) the person? Pure, shared by the browser's Gmail lookups
 * (gmail.ts#findEmailByName) and the server's address learning (replyTracking.ts). Owner, 2026-11-22: "Jess Zhang"
 * matched jacob.zhang@evercore.com (Jacob Zhang, a friend) because a mailbox with the last name that started with
 * the first initial was enough, and the alias learner took any one shared name word. Now both names have to agree,
 * and a different first name in the display name or the mailbox rules it out.
 */

export const normName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Jess" / "Jessica", "Mike" / "Michael"-style prefixes; never "Jess" / "Jacob". */
const NICK: Record<string, string[]> = {
  michael: ["mike", "mick"], william: ["will", "bill", "liam"], robert: ["rob", "bob", "bobby"], richard: ["rick", "dick", "rich"],
  james: ["jim", "jimmy", "jamie"], joseph: ["joe", "joey"], thomas: ["tom", "tommy"], christopher: ["chris"], nicholas: ["nick"],
  alexander: ["alex"], alexandra: ["alex", "lexi"], elizabeth: ["liz", "beth", "eliza", "lizzie"], katherine: ["kate", "katie", "kat"],
  catherine: ["cate", "cathy", "kate"], jonathan: ["jon"], benjamin: ["ben"], daniel: ["dan", "danny"], matthew: ["matt"],
  andrew: ["andy", "drew"], anthony: ["tony"], edward: ["ed", "eddie", "ted"], margaret: ["maggie", "meg", "peggy"],
  samuel: ["sam"], samantha: ["sam"], zachary: ["zach", "zack"], timothy: ["tim"], steven: ["steve"], stephen: ["steve"],
  gregory: ["greg"], jennifer: ["jen", "jenny"], rebecca: ["becca", "becky"], victoria: ["tori", "vicky"], patrick: ["pat"],
  theodore: ["theo", "ted"], nathaniel: ["nate", "nathan"], nathan: ["nate"], joshua: ["josh"], jacob: ["jake"], abigail: ["abby"],
};

/** Two first names that can be the same person. */
export function sameFirst(a: string, b: string) {
  const [x, y] = [normName(a).replace(/ /g, ""), normName(b).replace(/ /g, "")];
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
  return (NICK[x] ?? []).includes(y) || (NICK[y] ?? []).includes(x);
}

/**
 * The address belongs to First Last: the display name has both names (a nickname is fine), or the mailbox is
 * first+last / initial+last / last+initial (a middle initial is fine). A display name or mailbox that names someone
 * else with the same last name is not them.
 */
export function addressIsPerson(a: { name: string; email: string }, first: string, last: string) {
  const f = normName(first).split(" ")[0] ?? "";
  const l = normName(last);
  if (!f || !l) return false;
  const lastWords = l.split(" ");
  const lj = l.replace(/ /g, "");
  const dn = normName(a.name).split(" ").filter(Boolean);
  if (dn.length >= 2) {
    const hasLast = lastWords.every((w) => dn.includes(w)) || dn.join("").includes(lj);
    const others = dn.filter((w) => !lastWords.includes(w) && w.length > 1);
    if (hasLast) return others.length > 0 && others.some((w) => sameFirst(w, f));
    // A full display name without their last name is someone else.
    if (others.length >= 2) return false;
  }
  const local = a.email.split("@")[0].toLowerCase();
  const pieces = local.split(/[._-]+/).filter(Boolean);
  const flat = local.replace(/[^a-z]/g, "");
  if (!flat.includes(lj)) return false;
  // first.last / last.first / f.last / last.f (a middle initial between is fine)
  if (pieces.length >= 2) {
    const rest = pieces.filter((p) => p.replace(/[^a-z]/g, "") !== lj && !lastWords.includes(p));
    if (!rest.length) return false;
    return rest.every((p) => p.length <= 1) ? rest[0][0] === f[0] : rest.some((p) => sameFirst(p.replace(/[^a-z]/g, ""), f)) && rest.every((p) => p.length <= 1 || sameFirst(p.replace(/[^a-z]/g, ""), f));
  }
  // One piece: jzhang / zhangj / jesszhang / jmzhang. "jacobzhang" names someone else.
  const rest = flat.replace(lj, "");
  if (!rest) return false;
  if (rest.length <= 2) return rest[0] === f[0];
  return sameFirst(rest, f);
}
