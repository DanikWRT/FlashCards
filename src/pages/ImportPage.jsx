import { useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { addSet } from '../store.js'

function parseAndValidate(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error('Некорректный JSON: ' + e.message)
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('JSON должен быть объектом с полем "cards".')
  }

  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    throw new Error('В наборе нет ни одной карточки. Нужно поле "cards" с массивом карточек.')
  }

  const cards = data.cards.map((card, i) => {
    if (typeof card !== 'object' || card === null) {
      throw new Error(`Карточка #${i + 1} не является объектом.`)
    }
    if (typeof card.word !== 'string' || !card.word.trim()) {
      throw new Error(`У карточки #${i + 1} отсутствует или пусто поле "word".`)
    }
    if (typeof card.translation !== 'string' || !card.translation.trim()) {
      throw new Error(`У карточки #${i + 1} (${card.word}) отсутствует или пусто поле "translation".`)
    }
    return {
      word: card.word,
      translation: card.translation,
      examples: Array.isArray(card.examples) ? card.examples : [],
      family: typeof card.family === 'string' ? card.family : undefined,
    }
  })

  return {
    topic: typeof data.topic === 'string' ? data.topic : '',
    lesson_meta: (data.lesson_meta && typeof data.lesson_meta === 'object')
      ? data.lesson_meta
      : {},
    cards,
  }
}

// ---------------- K11 AI generation helpers ----------------

// Call our backend proxy (Vite forwards /api -> localhost:5198). The API key
// stays server-side (process.env.WORMSOFT_API_KEY) — never in the frontend.
async function callAI(prompt) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, max_tokens: 1000 }),
  })
  if (!res.ok) throw new Error('Бэкенд ответил с кодом ' + res.status)
  const data = await res.json()
  if (!data || typeof data.content !== 'string') {
    throw new Error('Бэкенд вернул неожиданный ответ.')
  }
  return data.content
}

// Pull the first JSON object out of a model reply (handles ```json fences).
function extractJson(text) {
  const cleaned = String(text).replace(/```[a-z]*/gi, '').trim()
  let start = cleaned.indexOf('{')
  let end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('В ответе не найден JSON.')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export default function ImportPage() {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('') // stub/info message for AI actions
  const fileRef = useRef(null)
  const navigate = useNavigate()

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setText(String(reader.result))
      setError('')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImport = () => {
    setError('')
    setSuccess('')
    if (!text.trim()) {
      setError('Вставьте JSON или выберите файл.')
      return
    }
    try {
      const parsed = parseAndValidate(text)
      const set = {
        id: crypto.randomUUID(),
        topic: parsed.topic,
        lesson_meta: parsed.lesson_meta,
        cards: parsed.cards,
        createdAt: new Date().toISOString(),
      }
      addSet(set)
      setSuccess(`Набор «${set.topic}» импортирован (${set.cards.length} карточек).`)
      setText('')
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    }
  }

  // Build a cards set from a successful AI reply and either navigate to it
  // (generate-cards) or drop the JSON into the textarea for review (translate).
  const finishAiCards = (content, topicFallback, mode) => {
    const data = extractJson(content)
    const cards = Array.isArray(data.cards) ? data.cards : []
    if (!cards.length) throw new Error('Модель не вернула карточек.')
    const parsed = parseAndValidate(JSON.stringify({
      topic: data.topic || topicFallback,
      cards,
    }))
    if (mode === 'create') {
      const set = {
        id: crypto.randomUUID(),
        topic: parsed.topic,
        lesson_meta: parsed.lesson_meta,
        cards: parsed.cards,
        createdAt: new Date().toISOString(),
      }
      addSet(set)
      setAiMsg(`Сгенерировано карточек: ${set.cards.length}. Набор «${set.topic}» создан.`)
      navigate('/', { replace: true })
    } else {
      const pretty = JSON.stringify({ topic: parsed.topic, cards: parsed.cards }, null, 2)
      setText(pretty)
      setAiMsg(`Сгенерировано карточек: ${parsed.cards.length}. JSON готов к импорту ниже.`)
    }
  }

  const runAi = async (buildPrompt, topicFallback, mode) => {
    setError('')
    setSuccess('')
    setAiMsg('')
    if (!text.trim()) {
      setError('Вставьте заметки или список слов (по одному в строке).')
      return
    }
    setAiBusy(true)
    setAiMsg('Запрос к AI-бэкенду…')
    try {
      const content = await callAI(buildPrompt(text))
      finishAiCards(content, topicFallback, mode)
    } catch (err) {
      // Backend unreachable / parse failure -> show a stub message.
      setAiMsg('⚠ Бэкенд AI недоступен или вернул ошибку. Показываю заглушку: вставьте заметки вручную.')
    } finally {
      setAiBusy(false)
    }
  }

  const genCards = () => runAi(
    (notes) => `Создай набор карточек для изучения английского по списку слов ниже. Ответь строго JSON-объектом вида {"topic":"...название...","cards":[{"word":"англ","translation":"перевод"}]}. Слова:\n${notes}`,
    'Сгенерированный набор',
    'create'
  )

  const genTranslations = () => runAi(
    (notes) => `Дай переводы на русский для слов ниже. Ответь строго JSON-объектом вида {"cards":[{"word":"англ","translation":"перевод"}]}. Слова:\n${notes}`,
    'Сгенерированный набор',
    'preview'
  )

  return (
    <div className="page import-page">
      <Link to="/" className="back-link">← Мои наборы</Link>
      <h1>Импорт набора JSON</h1>
      <p className="hint">Вставьте JSON набора или загрузите файл. Формат:</p>
      <pre className="pre">{
"{\n  \"topic\": \"Название набора\",\n  \"cards\": [\n    { \"word\": \"словарное слово\", \"translation\": \"перевод\" }\n  ]\n}"
      }</pre>

      {/* ------- K11 AI generation ------- */}
      <section className="k11-ai" data-testid="k11-ai">
        <h2 className="k11-panel-title">✨ Генерация с помощью AI</h2>
        <p className="hint">Вставьте заметки или список слов (по одному в строке) в поле ниже, затем выберите действие.</p>
        <div className="import-actions k11-ai-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={genCards}
            disabled={aiBusy}
            data-testid="ai-gen-cards"
          >
            Сгенерировать карточки из заметок
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={genTranslations}
            disabled={aiBusy}
            data-testid="ai-gen-trans"
          >
            Сгенерировать переводы/определения
          </button>
        </div>
        {aiMsg && <div className="k11-ai-msg" data-testid="ai-msg">{aiMsg}</div>}
      </section>

      <textarea
        className="json-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Вставьте заметки или JSON набора здесь..."}
        rows={12}
        data-testid="import-text"
      />

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="import-actions">
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile} hidden />
        <button className="btn btn-outline" onClick={() => fileRef.current && fileRef.current.click()}>
          Выбрать файл
        </button>
        <button className="btn btn-primary" onClick={handleImport}>
          Импортировать набор
        </button>
      </div>
    </div>
  )
}
