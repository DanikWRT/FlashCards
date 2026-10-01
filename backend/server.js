// FlashCards K11 AI backend proxy.
//
// Single endpoint: POST /api/ai  { prompt, max_tokens }
// Proxies the request to the wormsoft GPT endpoint using the model
// deepseek-ai/deepseek-v4-flash. The API key is read at runtime from
// process.env.WORMSOFT_API_KEY (loaded from ~/.hermes/.env) and is NEVER
// hardcoded here nor exposed to the browser.

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import os from 'os'
import path from 'path'

function loadKey() {
  if (process.env.WORMSOFT_API_KEY) return
  try {
    const envPath = path.join(os.homedir(), '.hermes', '.env')
    const txt = fs.readFileSync(envPath, 'utf8')
    // Accept the key under any of these variable names. The key is NEVER printed
    // or sent to the browser — it stays server-side in process.env only.
    const candidates = [
      'WORMSOFT_API_KEY',
      'MCP_WORMSOFT_API_KEY',
      'HERMES_CUSTOM_AI_WORMSOFT_RU_API_KEY',
    ]
    for (const name of candidates) {
      const m = txt.match(new RegExp('^\\s*' + name + '\\s*=\\s*([^\\s\"]+)\\s*$', 'm'))
      if (m && m[1]) {
        process.env.WORMSOFT_API_KEY = m[1].trim()
        return
      }
    }
  } catch (e) {
    // key will simply be missing -> endpoint returns a clear error
  }
}

loadKey()

const UPSTREAM = 'https://ai.wormsoft.ru/api/gpt/chat/completions'
const MODEL = 'deepseek-ai/deepseek-v4-flash'
const PORT = Number(process.env.PORT) || 5198

const app = express()
app.use(cors({ origin: ['http://127.0.0.1:5174', 'http://localhost:5174'] }))
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'fc-backend k11', port: PORT })
})

app.get('/health', (req, res) => {
  res.json({ ok: true, hasKey: !!process.env.WORMSOFT_API_KEY })
})

app.post('/api/ai', async (req, res) => {
  const prompt = (req.body && typeof req.body.prompt === 'string' && req.body.prompt) || ''
  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'prompt is required' })
  }
  const max_tokens = Number((req.body && req.body.max_tokens) || 800)
  const key = process.env.WORMSOFT_API_KEY
  if (!key) {
    return res.status(500).json({ ok: false, error: 'WORMSOFT_API_KEY not set on the server' })
  }

  let upstreamRes
  try {
    upstreamRes = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens,
      }),
    })
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'upstream unreachable: ' + String(e.message || e) })
  }

  let data
  try {
    data = await upstreamRes.json()
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'invalid upstream response' })
  }

  const content =
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : JSON.stringify(data)

  res.status(upstreamRes.ok ? 200 : 502).json({ ok: upstreamRes.ok, content })
})

app.listen(PORT, () => {
  console.log('FC backend listening on http://localhost:' + PORT)
})
