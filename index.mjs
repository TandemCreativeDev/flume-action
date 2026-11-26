// Flume's GitHub Action (SPEC 8.37, docs/INFRA.md "GitHub"). Two modes:
//
// - check: fails unless the pull request names a Flume key after Closes,
//   Fixes, Resolves or Part of, or has the no-ticket label, explaining how to
//   fix it in one sticky comment that is removed once the check passes.
// - sync: sends the pull request to Flume, which moves what it names, and
//   posts a new comment for each event saying where each item moved, so the
//   pull request keeps a record. Anything that didn't move as asked, and any
//   failure to reach Flume, tags the pull request's author.
//
// Both skip pull requests a bot opened and any not into the default branch.
// No dependencies: it runs on the runner's Node with fetch.

import { readFileSync } from "node:fs"

import { ticketCheck } from "./keys.mjs"

const input = (name, fallback = "") => process.env[`INPUT_${name.replaceAll(" ", "_").toUpperCase()}`]?.trim() || fallback
const mode = input("mode")
const githubToken = input("github-token")
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
const pr = event.pull_request
const repo = event.repository
const api = process.env.GITHUB_API_URL || "https://api.github.com"

/** A comment's hidden marker, one per mode. */
const marker = (kind) => `<!-- flume:${kind} -->`

async function github(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(init.body ? { "content-type": "application/json" } : {}) },
  })
  if (!res.ok && res.status !== 404) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 || res.status === 404 ? null : res.json()
}

/** Every comment on the pull request, oldest first, however many pages. */
async function allComments() {
  const all = []
  for (let page = 1; ; page++) {
    const batch = (await github(`/repos/${repo.full_name}/issues/${pr.number}/comments?per_page=100&page=${page}`)) ?? []
    all.push(...batch)
    if (batch.length < 100) return all
  }
}

/** Writes, edits in place or (with null) removes the ticket check's one comment: a fix-it note, not a record. */
async function sticky(kind, body) {
  const mine = (await allComments()).find((c) => c.body?.includes(marker(kind)))
  if (body === null) {
    if (mine) await github(`/repos/${repo.full_name}/issues/comments/${mine.id}`, { method: "DELETE" })
    return
  }
  const text = `${marker(kind)}\n${body}`
  if (mine) await github(`/repos/${repo.full_name}/issues/comments/${mine.id}`, { method: "PATCH", body: JSON.stringify({ body: text }) })
  else await github(`/repos/${repo.full_name}/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body: text }) })
}

/** Whether the pull request's latest review from each reviewer leaves it approved. */
async function approved() {
  const reviews = (await github(`/repos/${repo.full_name}/pulls/${pr.number}/reviews?per_page=100`)) ?? []
  const latest = new Map()
  for (const r of reviews) if (r.state !== "COMMENTED" && r.state !== "PENDING") latest.set(r.user?.login, r.state)
  const states = [...latest.values()]
  return states.includes("APPROVED") && !states.includes("CHANGES_REQUESTED")
}

function skipped() {
  if (!pr) return "Not a pull request event"
  if (pr.user?.type === "Bot") return "Opened by a bot"
  if (pr.base?.ref !== repo.default_branch) return `Into ${pr.base?.ref}, not ${repo.default_branch}`
  return null
}

/**
 * Posts a new sync comment, so the pull request keeps every move. Skipped when
 * it would repeat the latest one word for word: a push that moved nothing.
 */
async function record(body) {
  const text = `${marker("sync")}\n${body}`
  const latest = (await allComments()).filter((c) => c.body?.includes(marker("sync"))).at(-1)
  if (latest?.body === text) return
  await github(`/repos/${repo.full_name}/issues/${pr.number}/comments`, { method: "POST", body: JSON.stringify({ body: text }) })
}

async function check() {
  const result = ticketCheck({ title: pr.title ?? "", body: pr.body ?? "", labels: (pr.labels ?? []).map((l) => l.name) }, input("no-ticket-label", "no-ticket"))
  await sticky("check", result.ok ? null : result.message)
  if (!result.ok) {
    console.log(result.message)
    process.exitCode = 1
  } else console.log("Names a Flume story or task.")
}

async function sync() {
  const token = input("flume-token")
  if (!token) throw new Error("Set the FLUME_TOKEN secret: a repository token from the Flume project's settings page.")
  const res = await fetch(`${input("flume-url", "https://flume.zestdev.uk").replace(/\/+$/, "")}/api/github`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      repository: repo.full_name,
      defaultBranch: repo.default_branch,
      base: pr.base.ref,
      number: pr.number,
      url: pr.html_url,
      title: pr.title ?? "",
      body: pr.body ?? "",
      state: pr.state,
      draft: Boolean(pr.draft),
      merged: Boolean(pr.merged),
      approved: await approved(),
      author: pr.user?.login ?? null,
      authorIsBot: pr.user?.type === "Bot",
      mergedBy: pr.merged_by?.login ?? null,
    }),
  })
  const answer = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Flume answered ${res.status}: ${answer.error ?? "no reason given"}`)
  if (answer.ignored) return console.log(`Flume ignored it: ${answer.ignored}`)
  if (answer.comment) await record(answer.comment)
  console.log(answer.comment ?? "Names nothing in Flume.")
}

try {
  const why = skipped()
  if (why) console.log(`Skipped: ${why}`)
  else if (mode === "check") await check()
  else if (mode === "sync") await sync()
  else throw new Error(`mode is check or sync, not ${mode || "empty"}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.log(`::error::${message}`)
  process.exitCode = 1
  // A sync that fails moves nothing in Flume: say so where the author will see it.
  if (mode === "sync" && pr) {
    const who = pr.user?.login ? `@${pr.user.login}, ` : ""
    await record(`**Flume** · Sync failed\n\n${who}Flume didn't record this pull request event, so nothing it names moved: ${message}`).catch((e) =>
      console.log(`::error::Couldn't comment on the pull request either: ${e instanceof Error ? e.message : e}`),
    )
  }
}
