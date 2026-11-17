import { build } from "esbuild"
import { cp } from "node:fs/promises"
import { buildExtension } from "@ham2k/extension-tools"

await buildExtension(build, { dir: import.meta.dirname })
await cp(new URL("./assets/", import.meta.url), new URL("./build/assets/", import.meta.url), { recursive: true })

console.log("built build/index.js")
