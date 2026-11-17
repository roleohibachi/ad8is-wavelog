import assert from "node:assert/strict"
import { test } from "node:test"
import type { HookContext, PanelRenderArgs } from "@ham2k/extension-sdk"

import type { Services } from "../src/account.ts"
import { createOperationPanel } from "../src/panel.ts"

// Rendering uses only supplied values, never the full log or account state.
const context = new Proxy({} as HookContext, {
  get(_target, key) {
    if (key === "account") return undefined
    throw new Error(`Unexpected host-context access: ${String(key)}`)
  },
})

const noServices: Services = {
  fetch: async () => assert.fail("Rendering must not fetch"),
  saveSession: async () => assert.fail("Rendering must not save"),
  showMessage: async () => assert.fail("Rendering must not open dialogs"),
}

function args(operation: PanelRenderArgs["operation"], count: number): PanelRenderArgs {
  return { panelKey: "operation", operation, qsoCount: count, config: {}, reason: "initial" }
}

test("switching operations renders the new identity and count without stale state", async () => {
  const panel = createOperationPanel("0.1.0-alpha.2", noServices)
  const first = await panel.render(args({ uuid: "op-a", title: "Summit A", stationCall: "AD8IS/P" }, 25), context)
  const second = await panel.render(args({ uuid: "op-b", title: "Park B", stationCall: "AD8IS" }, 3), context)
  assert.equal(first.kind, "markdown")
  assert.equal(second.kind, "markdown")
  if (first.kind !== "markdown" || second.kind !== "markdown") return
  assert.match(first.content, /Operation ID: op-a/)
  assert.match(first.content, /QSOs: 25/)
  assert.match(second.content, /Operation ID: op-b/)
  assert.match(second.content, /Station callsign: AD8IS/)
  assert.match(second.content, /QSOs: 3/)
  assert.doesNotMatch(second.content, /Summit A|op-a|QSOs: 25/)
})

test("log-change refresh uses Halo's supplied contact count, including deletion", async () => {
  const panel = createOperationPanel("test", noServices)
  const [descriptor] = await panel.getPanels({}, context)
  assert.deepEqual(descriptor.on, ["operation", "qsoLogged"])
  for (const count of [0, 1, 2, 1, 0]) {
    const result = await panel.render(args({ uuid: "op-a" }, count), context)
    if (result.kind !== "markdown") assert.fail("Expected Markdown")
    assert.match(result.content, new RegExp(`QSOs: ${count}(?:\\n|$)`))
    assert.equal(result.content.includes("No contacts logged yet."), count === 0)
  }
})

test("missing operation is an empty state rather than a stale or fabricated log", async () => {
  const result = await createOperationPanel("test", noServices).render(args({}, 0), context)
  if (result.kind !== "markdown") assert.fail("Expected Markdown")
  assert.match(result.content, /Open an operation/)
  assert.doesNotMatch(result.content, /Operation ID:|QSOs:/)
})

test("operation titles cannot inject Markdown images, links, HTML, or new lines", async () => {
  const result = await createOperationPanel("test", noServices).render(
    args({ uuid: "op-a", title: "![image](https://example.com/x)\n# <b>Title</b> &copy;" }, 1),
    context,
  )
  if (result.kind !== "markdown") assert.fail("Expected Markdown")
  assert.ok(result.content.includes("\\!\\[image\\]\\(https://example.com/x\\) \\# \\<b\\>Title\\</b\\> \\&copy;"))
})
