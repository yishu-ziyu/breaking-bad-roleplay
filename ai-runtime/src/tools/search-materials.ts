import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SEARCH_ROOTS = [
  join(ROOT, "ai-runtime", "resources", "characters"),
  join(ROOT, "materials", "breaking-bad", "intelligence"),
]

const BLOCKED = [
  "synthesize",
  "pseudoephedrine",
  "how to cook",
  "how to make meth",
  "launder",
  "weaponize",
]

export function searchMaterials(query: string, limit = 3): string {
  const needle = query.trim().toLowerCase()
  if (!needle) return "Empty query."
  if (BLOCKED.some(word => needle.includes(word))) {
    return "Refused: real-world crime/chemistry search is not available."
  }
  const hits: string[] = []
  for (const root of SEARCH_ROOTS) {
    walk(root, file => {
      if (hits.length >= limit) return
      if (![".md", ".txt"].includes(extname(file))) return
      const text = readFileSync(file, "utf8")
      if (!text.toLowerCase().includes(needle)) return
      const snippet = text.replace(/\s+/g, " ").slice(0, 280)
      hits.push(`${file.replace(ROOT + "/", "")}: ${snippet}`)
    })
  }
  return hits.length ? hits.join("\n---\n") : "No matching materials."
}

function walk(dir: string, visit: (file: string) => void): void {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const path = join(dir, name)
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (stat.isDirectory()) walk(path, visit)
    else visit(path)
  }
}

export function searchMaterialsTool() {
  return {
    name: "search_materials" as const,
    description: "Search character intelligence notes. Read-only. No crime recipes.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: async (_id: string, args: { query?: string }) => ({
      content: [{ type: "text" as const, text: searchMaterials(String(args.query ?? "")) }],
      details: { readonly: true },
    }),
  }
}
