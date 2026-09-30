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

export default function ImportPage() {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
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

  return (
    <div className="page import-page">
      <Link to="/" className="back-link">← Мои наборы</Link>
      <h1>Импорт набора JSON</h1>
      <p className="hint">Вставьте JSON набора или загрузите файл. Формат:</p>
      <pre className="pre">{
"{\n  \"topic\": \"Название набора\",\n  \"cards\": [\n    { \"word\": \"словарное слово\", \"translation\": \"перевод\" }\n  ]\n}"
      }</pre>

      <textarea
        className="json-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Вставьте JSON набора здесь..."}
        rows={12}
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
