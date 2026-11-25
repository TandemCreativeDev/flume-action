// The Action's copy of core's key rules (packages/core/src/github.ts, SPEC 8.37).
// The Action runs with no dependencies, so it can't import core; a core test
// runs both over the same cases to keep them in step. Change both together.

const VERB = String.raw`\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\s+of)\b`
const KEY = String.raw`[A-Za-z][A-Za-z0-9]*-\d+\b`
const LIST = new RegExp(`${VERB}[\\s:]*((?:${KEY})(?:\\s*(?:,|&|\\band\\b)\\s*${KEY})*)`, "gi")

/** The text with code blocks and inline code removed, so documentation can't move real work. */
export function withoutCode(text) {
  return text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "")
}

/** The keys after Closes, Fixes or Resolves, and after Part of, upper-case, each once. */
export function pullRequestKeys(title, body) {
  const closes = new Set()
  const partOf = new Set()
  for (const match of withoutCode(`${title}\n${body}`).matchAll(LIST)) {
    const target = /^part/i.test(match[1]) ? partOf : closes
    for (const key of match[2].match(new RegExp(KEY, "g")) ?? []) target.add(key.toUpperCase())
  }
  return { closes: [...closes], partOf: [...partOf].filter((k) => !closes.has(k)) }
}

/** The ticket check: a key after Closes, Fixes, Resolves or Part of, or the no-ticket label. */
export function ticketCheck(pr, label = "no-ticket") {
  const keys = pullRequestKeys(pr.title, pr.body)
  if (keys.closes.length > 0 || keys.partOf.length > 0 || pr.labels.includes(label)) return { ok: true }
  return {
    ok: false,
    message: [
      "This pull request doesn't name a Flume story or task.",
      "",
      'Add a line to its description saying what it finishes, such as "Closes CT2-12", or what it is one step of, such as "Part of CT2-12". Fixes and Resolves work as Closes. Keys inside backticks or code blocks don\'t count.',
      "",
      `If it has no ticket (CI, docs or a chore), add the \`${label}\` label instead.`,
    ].join("\n"),
  }
}
