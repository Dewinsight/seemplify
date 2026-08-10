const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")

const candidateDir = path.resolve(__dirname, "..")

function loadPlaywright() {
  const roots = [
    path.join(candidateDir, "node_modules"),
    path.resolve(candidateDir, "..", "..", "node_modules"),
    process.env.CODEX_NODE_MODULES,
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules"),
  ].filter(Boolean)

  for (const root of roots) {
    try {
      const directPath = path.join(root, "playwright")
      if (fs.existsSync(directPath)) return require(directPath)
      return require(require.resolve("playwright", { paths: [root] }))
    } catch {
      // Try the next known dependency root.
    }
  }

  throw new Error("Playwright is required for this browser verifier. Install it locally or set CODEX_NODE_MODULES.")
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function createA4PdfBuffer() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 74 >>\nstream\nBT /F1 18 Tf 72 760 Td (Candidate transition browser flow test) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets = [0]

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, "latin1")
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += "0000000000 65535 f \n"
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, "latin1")
}

function iso(daysFromNow) {
  const date = new Date("2026-06-09T12:00:00.000Z")
  date.setUTCDate(date.getUTCDate() + daysFromNow)
  return date.toISOString()
}

function createMockState() {
  return {
    forgotPasswordEmail: "",
    resetPassword: null,
    formStatus: "draft",
    formValues: {},
    documents: {
      bioDoc: "pending",
      agreementDoc: "pending",
    },
    requests: [],
  }
}

function documentActionType(document) {
  const fields = document.signatureFields.filter((field) => (field.role || "candidate") === "candidate")
  const hasSignature = fields.some((field) => field.type === "signature")
  const hasFill = fields.some((field) => field.type === "text" || field.type === "image")
  if (hasFill && !hasSignature) return "document_fill"
  if (hasSignature) return "document_sign"
  return null
}

function createTransitionRecord(state) {
  const bioCompleted = state.documents.bioDoc !== "pending"
  const agreementCompleted = state.documents.agreementDoc !== "pending"
  const formDone = state.formStatus === "approved"
  const allDone = formDone && bioCompleted && agreementCompleted

  const documents = [
    {
      _id: "bioDoc",
      document: "source-bio",
      title: "Bank account information",
      status: state.documents.bioDoc,
      signatureFields: [
        {
          id: "bankDetails",
          role: "candidate",
          type: "text",
          label: "Bank account details",
          placeholder: "Sort code, account number, and account name",
          multiline: true,
          page: 1,
          x: 0.12,
          y: 0.34,
          width: 0.68,
          height: 0.16,
          required: true,
        },
      ],
    },
    {
      _id: "agreementDoc",
      document: "source-agreement",
      title: "Employment agreement",
      status: state.documents.agreementDoc,
      signatureFields: [
        {
          id: "emergencyContact",
          role: "candidate",
          type: "text",
          label: "Emergency contact",
          placeholder: "Name and phone number",
          page: 1,
          x: 0.12,
          y: 0.22,
          width: 0.55,
          height: 0.06,
          required: true,
        },
        {
          id: "candidateSignature",
          role: "candidate",
          type: "signature",
          label: "Candidate signature",
          page: 1,
          x: 0.12,
          y: 0.48,
          width: 0.36,
          height: 0.1,
          required: true,
        },
      ],
    },
  ]

  const envelope = {
    _id: "env1",
    title: "Candidate transition packet",
    message: "Complete the documents in the recruiter-selected order.",
    status: allDone ? "completed" : agreementCompleted ? "partially_signed" : "sent",
    documents,
    signers: [
      {
        _id: "signer1",
        role: "candidate",
        name: "Ava Stone",
        email: "ava@example.com",
        order: 1,
        status: allDone ? "signed" : "viewed",
      },
    ],
    createdAt: iso(-1),
    updatedAt: iso(0),
  }

  let nextAction = null
  if (!formDone) {
    nextAction = {
      type: "form",
      label: "Candidate biodata",
      href: "/forms/form1",
      dueAt: iso(2),
      status: state.formStatus,
      processType: "onboarding",
      recordId: "transition1",
      sourceIds: { formId: "form1" },
    }
  } else if (!bioCompleted) {
    nextAction = {
      type: "document_fill",
      label: "Bank account information",
      href: "/documents/bioDoc/sign",
      dueAt: iso(3),
      status: state.documents.bioDoc,
      processType: "onboarding",
      recordId: "transition1",
      sourceIds: { envelopeId: "env1", documentId: "bioDoc" },
    }
  } else if (!agreementCompleted) {
    nextAction = {
      type: "document_sign",
      label: "Employment agreement",
      href: "/documents/agreementDoc/sign",
      dueAt: iso(3),
      status: state.documents.agreementDoc,
      processType: "onboarding",
      recordId: "transition1",
      sourceIds: { envelopeId: "env1", documentId: "agreementDoc" },
    }
  } else {
    nextAction = {
      type: "waiting",
      label: "Waiting for HR provisioning",
      href: "/transitions/transition1",
      status: "ready_to_provision",
      processType: "onboarding",
      recordId: "transition1",
    }
  }

  return {
    _id: "transition1",
    title: "Ava Stone onboarding",
    processType: "onboarding",
    status: allDone ? "ready_to_provision" : "in_progress",
    candidate: {
      _id: "candidate1",
      firstName: "Ava",
      lastName: "Stone",
      email: "ava@example.com",
      status: "Onboarding",
    },
    organization: {
      _id: "org1",
      name: "Seemplify Test",
    },
    forms: [
      {
        _id: "form1",
        title: "Candidate biodata",
        status: state.formStatus,
        templateSnapshot: {
          fields: [
            {
              id: "phone",
              key: "phone",
              label: "Phone number",
              type: "phone",
              required: true,
              placeholder: "0800 000 0000",
              order: 1,
            },
          ],
        },
        values: Object.entries(state.formValues).map(([key, value]) => ({
          fieldId: key,
          key,
          label: key === "phone" ? "Phone number" : key,
          type: "phone",
          sensitive: false,
          value,
        })),
        hasSensitiveValues: false,
      },
    ],
    envelopes: [envelope],
    workflowItems: [
      {
        _id: "wf-form",
        type: "form",
        title: "Complete candidate biodata",
        status: formDone ? "completed" : "pending",
        ownerType: "candidate",
        required: true,
        order: 1,
        dueAt: iso(2),
        sourceType: "form",
        sourceId: "form1",
      },
      {
        _id: "wf-documents",
        type: "document",
        title: "Review and complete documents",
        status: bioCompleted && agreementCompleted ? "completed" : "pending",
        ownerType: "candidate",
        required: true,
        order: 2,
        dueAt: iso(3),
        sourceType: "envelope",
        sourceId: "env1",
      },
    ],
    nextAction,
    progress: {
      totalItems: 3,
      completedItems: [formDone, bioCompleted, agreementCompleted].filter(Boolean).length,
      percent: Math.round(([formDone, bioCompleted, agreementCompleted].filter(Boolean).length / 3) * 100),
    },
    startedAt: iso(-1),
    createdAt: iso(-1),
    updatedAt: iso(0),
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" })
  response.end(JSON.stringify(payload))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
  })
}

function startMockApi(port, state) {
  const pdf = createA4PdfBuffer()

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`)
      const record = createTransitionRecord(state)

      if (url.pathname === "/api/candidate-portal/auth/forgot-password" && request.method === "POST") {
        const payload = await readJson(request)
        state.forgotPasswordEmail = payload.email || ""
        state.requests.push(["forgotPassword", state.forgotPasswordEmail])
        return sendJson(response, { msg: "If a candidate account with that email exists, a password reset link has been sent." })
      }

      if (url.pathname === "/api/candidate-portal/auth/reset-password" && request.method === "POST") {
        const payload = await readJson(request)
        assert.equal(payload.token, "mock-reset-token", "reset page should submit the URL token")
        assert.equal(payload.password, "UpdatedPassword123!", "reset page should submit the new password")
        state.resetPassword = payload.password
        state.requests.push(["resetPassword", payload.token])
        return sendJson(response, { msg: "Your candidate portal password has been reset successfully" })
      }

      if (url.pathname === "/api/candidate-portal/me" && request.method === "GET") {
        return sendJson(response, {
          account: {
            _id: "account1",
            email: "ava@example.com",
            profile: { firstName: "Ava", lastName: "Stone", phone: "0800 000 0000" },
            status: "active",
          },
        })
      }

      if (url.pathname === "/api/candidate-portal/transitions" && request.method === "GET") {
        return sendJson(response, { data: [record] })
      }

      if (url.pathname === "/api/candidate-portal/transitions/transition1" && request.method === "GET") {
        return sendJson(response, { data: record })
      }

      if (url.pathname === "/api/candidate-portal/forms/form1" && request.method === "GET") {
        return sendJson(response, { data: record.forms[0], transition: record })
      }

      if (url.pathname === "/api/candidate-portal/forms/form1/save" && request.method === "POST") {
        const payload = await readJson(request)
        state.formValues = payload.values || {}
        state.requests.push(["saveForm", state.formValues])
        return sendJson(response, { data: createTransitionRecord(state).forms[0], transition: createTransitionRecord(state) })
      }

      if (url.pathname === "/api/candidate-portal/forms/form1/submit" && request.method === "POST") {
        const payload = await readJson(request)
        state.formValues = payload.values || {}
        state.formStatus = "approved"
        state.requests.push(["submitForm", state.formValues])
        return sendJson(response, { data: createTransitionRecord(state).forms[0], transition: createTransitionRecord(state) })
      }

      const documentMatch = url.pathname.match(/^\/api\/candidate-portal\/documents\/([^/]+)(?:\/([^/]+))?$/)
      if (documentMatch) {
        const documentId = documentMatch[1]
        const action = documentMatch[2] || ""
        const nextRecord = createTransitionRecord(state)
        const envelope = nextRecord.envelopes[0]
        const document = envelope.documents.find((item) => item._id === documentId)
        if (!document) return sendJson(response, { msg: "Document not found" }, 404)

        if (!action && request.method === "GET") {
          const actionType = documentActionType(document)
          return sendJson(response, {
            data: {
              envelope,
              document,
              signer: envelope.signers[0],
              canSign: document.status === "pending" && Boolean(actionType),
              actionType,
              canCompleteFillOnly: actionType === "document_fill",
              nextDocumentId: documentId === "bioDoc" && state.documents.bioDoc !== "pending" && state.documents.agreementDoc === "pending"
                ? "agreementDoc"
                : null,
              downloadUrl: `/api/candidate-portal/documents/${documentId}/download`,
            },
            transition: nextRecord,
          })
        }

        if (action === "preview" && request.method === "GET") {
          response.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Length": pdf.length,
          })
          return response.end(pdf)
        }

        if (action === "download" && request.method === "GET") {
          response.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${document.title}.pdf"`,
            "Content-Length": pdf.length,
          })
          return response.end(pdf)
        }

        if (action === "complete" && request.method === "POST") {
          const payload = await readJson(request)
          assert.equal(documentId, "bioDoc", "Only the fill-only document should use complete")
          assert.ok(String(payload.fieldValues?.bankDetails || "").trim(), "Fill-only text field should be submitted")
          state.documents.bioDoc = "completed"
          state.requests.push(["completeDocument", documentId, payload.fieldValues])
          const updated = createTransitionRecord(state)
          return sendJson(response, {
            data: updated.envelopes[0],
            nextDocumentId: "agreementDoc",
            transition: updated,
          })
        }

        if (action === "sign" && request.method === "POST") {
          const payload = await readJson(request)
          assert.equal(documentId, "agreementDoc", "Only the signature document should use sign")
          assert.ok(String(payload.signatureDataUrl || "").startsWith("data:image/png"), "Signature data URL should be submitted")
          assert.ok(String(payload.fieldValues?.emergencyContact || "").trim(), "Candidate text field should be submitted with signature")
          state.documents.agreementDoc = "completed"
          state.requests.push(["signDocument", documentId, payload.fieldValues])
          const updated = createTransitionRecord(state)
          return sendJson(response, {
            data: updated.envelopes[0],
            nextDocumentId: null,
            transition: updated,
          })
        }
      }

      sendJson(response, { msg: `Unhandled ${request.method} ${url.pathname}` }, 404)
    } catch (error) {
      sendJson(response, { msg: error.message || "Mock API error" }, 500)
    }
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}

function waitForHttp(url, timeoutMs = 45_000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (response) => {
        response.resume()
        resolve()
      }).on("error", (error) => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(error)
          return
        }
        setTimeout(tick, 500)
      })
    }
    tick()
  })
}

function stopChild(child) {
  if (!child?.pid) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
    return
  }
  child.kill("SIGTERM")
}

function childEnv(extra = {}) {
  const env = {}
  Object.entries(process.env).forEach(([key, value]) => {
    if (!key || key.startsWith("=") || value === undefined) return
    env[key] = String(value)
  })
  return { ...env, ...extra }
}

async function closeServer(server) {
  if (!server) return
  await new Promise((resolve) => server.close(resolve))
}

async function main() {
  const { chromium } = loadPlaywright()
  const apiPort = await getFreePort()
  const appPort = await getFreePort()
  const state = createMockState()
  const apiServer = await startMockApi(apiPort, state)
  const nextBin = require.resolve("next/dist/bin/next", { paths: [candidateDir] })
  let appProcess = null
  let browser = null
  const appOutput = []

  try {
    appProcess = spawn(process.execPath, [nextBin, "dev", "-p", String(appPort)], {
      cwd: candidateDir,
      env: childEnv({
        API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
        NEXT_PUBLIC_RECRUITER_API_BASE_URL: "",
      }),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    appProcess.stdout.on("data", (chunk) => appOutput.push(chunk.toString()))
    appProcess.stderr.on("data", (chunk) => appOutput.push(chunk.toString()))

    await waitForHttp(`http://127.0.0.1:${appPort}/login`)

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text())
    })

    await page.goto(`http://127.0.0.1:${appPort}/login`)
    await page.getByRole("link", { name: "Forgot password?" }).click()
    await page.waitForURL(/\/forgot-password$/)
    await page.getByLabel("Email").fill("ava@example.com")
    await page.getByRole("button", { name: "Send reset link" }).click()
    await page.getByRole("heading", { name: "Check your email" }).waitFor()
    assert.equal(state.forgotPasswordEmail, "ava@example.com", "forgot-password form should submit the candidate email")

    await page.goto(`http://127.0.0.1:${appPort}/reset-password/mock-reset-token`)
    await page.getByLabel("New password", { exact: true }).fill("UpdatedPassword123!")
    await page.getByLabel("Confirm new password", { exact: true }).fill("UpdatedPassword123!")
    await page.getByRole("button", { name: "Reset password" }).click()
    await page.getByRole("heading", { name: "Password reset" }).waitFor()
    assert.equal(state.resetPassword, "UpdatedPassword123!", "reset form should submit the new password")

    await page.addInitScript(() => {
      window.localStorage.setItem("seemplify_candidate_access_token", "mock-access-token")
      window.localStorage.setItem("seemplify_candidate_refresh_token", "mock-refresh-token")
      window.localStorage.setItem("seemplify_candidate_account", JSON.stringify({
        _id: "account1",
        email: "ava@example.com",
        profile: { firstName: "Ava", lastName: "Stone", phone: "0800 000 0000" },
        status: "active",
      }))
    })

    await page.goto(`http://127.0.0.1:${appPort}/dashboard`)
    await page.getByText("Next action").waitFor()
    await page.getByRole("link", { name: /Continue/i }).click()
    await page.waitForURL(/\/forms\/form1$/)

    await page.getByLabel(/Phone number/i).fill("0800 111 2222")
    await page.getByRole("button", { name: /Submit form/i }).click()
    await page.waitForURL(/\/documents\/bioDoc\/sign$/)
    assert.notEqual(new URL(page.url()).pathname, "/dashboard", "Form submission must not bounce to dashboard")

    const desktopSteps = page.locator("aside:visible").filter({ hasText: "Packet steps" }).first()
    await desktopSteps.getByText("1. Candidate biodata").waitFor()
    await desktopSteps.getByText("2. Bank account information").waitFor()
    await desktopSteps.getByText("3. Employment agreement").waitFor()
    await page.getByLabel(/Bank account details/i).fill("Account name: Ava Stone\nSort code: 12-34-56\nAccount number: 12345678")
    await page.getByRole("button", { name: /Complete document/i }).click()
    await page.waitForURL(/\/documents\/agreementDoc\/sign$/)
    assert.notEqual(new URL(page.url()).pathname, "/dashboard", "Fill-only completion must move to the next document")

    await desktopSteps.locator("a").filter({ hasText: "1. Candidate biodata" }).click()
    await page.waitForURL(/\/forms\/form1$/)
    await page.locator("aside:visible").filter({ hasText: "Packet steps" }).first().locator("a").filter({ hasText: "3. Employment agreement" }).click()
    await page.waitForURL(/\/documents\/agreementDoc\/sign$/)

    await page.setViewportSize({ width: 390, height: 900 })
    const mobileSteps = page.locator('section[aria-label="Packet steps"]')
    await mobileSteps.getByText("Step 3 of 3").waitFor()
    await mobileSteps.locator("a").filter({ hasText: "1. Candidate biodata" }).click()
    await page.waitForURL(/\/forms\/form1$/)
    await page.locator('section[aria-label="Packet steps"]').getByText("Step 1 of 3").waitFor()
    await page.locator('section[aria-label="Packet steps"]').locator("a").filter({ hasText: "3. Employment agreement" }).click()
    await page.waitForURL(/\/documents\/agreementDoc\/sign$/)

    await page.getByLabel(/Emergency contact/i).fill("Taylor Stone, 0800 333 4444")
    const canvas = page.locator("canvas.signature-canvas")
    await canvas.waitFor()
    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    assert.ok(box, "Signature canvas should be visible")
    await page.mouse.move(box.x + 40, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 140, box.y + 95, { steps: 6 })
    await page.mouse.move(box.x + 240, box.y + 70, { steps: 6 })
    await page.mouse.up()
    await page.getByRole("button", { name: /^Sign document$/i }).click()
    await page.waitForURL(/\/documents\/agreementDoc\/complete$/)

    await page.getByRole("heading", { name: "Document completed" }).waitFor()
    await page.locator("h2:visible", { hasText: "Packet steps" }).waitFor()
    assert.notEqual(new URL(page.url()).pathname, "/dashboard", "Final document signing must land on completion, not dashboard")

    const requestNames = state.requests.map((entry) => entry[0])
    assert.ok(requestNames.includes("forgotPassword"), "Forgot-password request should be made")
    assert.ok(requestNames.includes("resetPassword"), "Password reset request should be made")
    assert.ok(requestNames.includes("submitForm"), "Form submit request should be made")
    assert.ok(requestNames.includes("completeDocument"), "Fill-only document completion request should be made")
    assert.ok(requestNames.includes("signDocument"), "Signature document request should be made")
    assert.deepEqual(state.documents, { bioDoc: "completed", agreementDoc: "completed" })
    assert.deepEqual(pageErrors, [], `Browser errors were reported:\n${pageErrors.join("\n")}`)

    console.log("Candidate browser flow verified: password recovery -> dashboard -> form -> fill-only document -> signature document -> completion.")
  } catch (error) {
    console.error(appOutput.join(""))
    throw error
  } finally {
    if (browser) await browser.close()
    stopChild(appProcess)
    await closeServer(apiServer)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
