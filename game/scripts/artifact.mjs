// Turns the single-file build into an Artifact page body: the host supplies
// doctype/html/head/body, so keep the title, font link, style and script only.
import { readFileSync, writeFileSync } from "node:fs"
const html = readFileSync("dist/index.html", "utf8")
const head = html.match(/<head>([\s\S]*)<\/head>/)[1].replace(/<meta[^>]*>\s*/g, "")
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
const scripts = [...head.matchAll(/<script[\s\S]*?<\/script>/g)].map(m => m[0]).join("\n")
const rest = head.replace(/<script[\s\S]*?<\/script>/g, "")
writeFileSync("dist/abq-ledger.html", `${rest.trim()}\n${body.trim()}\n${scripts}\n`)
console.log("dist/abq-ledger.html", (readFileSync("dist/abq-ledger.html").length / 1024).toFixed(1) + " KB")
