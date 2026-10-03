import { useParams, Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth.jsx'
import LoginModal from '../components/LoginModal.jsx'
import {
  getSet, getStatus, getStatuses, setCardStatus, recordCardView,
  getRecord, saveRecord, getViews, applySrsAnswer, isDueOn, todayStr,
  resetSetProgress, downloadProgressReport, recordStudyDay,
  getCardStarred, toggleCardStarred, saveBlastScore, pushLeaderboard,
  addCardsShared, initNewCardProgress,
  apiGetSet,
} from '../store.js'
import { matchAnswer } from '../normalize.js'

// K23: shared registries so the single top-level keydown handler can reach into
// the currently-active study mode. Only one mode is ever mounted at a time, so
// a module-level registry is safe: each answer-bearing component overwrites the
// option handlers it currently renders, and clears them on unmount/transition.
//   answerRegistry.handlers : array of () => void, one per visible answer button
//                             (index n <-> digit key n+1).
//   matchRegistry           : Match mode's live handler for digit+letter pairing.
//   studyRegistry           : study-mode (Learn/Write/Spell) shuffle handler.
//   advanceRegistry         : study-mode advance (Далее) handler for Enter key.
const answerRegistry = { handlers: [] }
const matchRegistry = { active: false, handle: null }
const studyRegistry = { shuffleNow: null }
const advanceRegistry = { handler: null }

// ---------- K10 flashcard helpers ----------

// Optional card image (K7 acceptance: a card MAY have an 'image' URL field).
// Renders <img> with an onError fallback so a broken URL never breaks the deck.
// K22: parse a paste of card JSON for the "+ Добавить карточки" inline form.
// Accepts a JSON object with a `cards` array of {word, translation, examples?,
// family?} — the same shape ImportPage uses but without topic/lesson_meta.
function parseCardsOnly(text) {
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
    throw new Error('Нужно поле "cards" с массивом из одной или нескольких карточек.')
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
  return { cards }
}

// K22: turn a thrown add-cards error into a user-facing Russian message.
function addCardsErrorMsg(err) {
  const msg = (err && err.message) || String(err)
  if (/401/.test(msg)) return 'Войдите, чтобы добавить карточки.'
  if (/403/.test(msg)) return 'Только автор или админ может добавлять карточки.'
  if (/404/.test(msg)) return 'Набор не найден.'
  return msg || 'Не удалось добавить карточки.'
}

function CardImage({ src }) {
  const [err, setErr] = useState(false)
  if (!src || err) return null
  return <img className="card-image" src={src} alt="" onError={() => setErr(true)} />
}

// Front (English word) face — shared by the normal deck and fullscreen viewer.
function CardFront({ card }) {
  return (
    <div className="flashcard-face front">
      <span className="face-label">EN · Слово</span>
      {card.image && <CardImage src={card.image} />}
      <h2 className="face-word">{card.word}</h2>
      <span className="face-hint">Нажмите, чтобы перевернуть</span>
    </div>
  )
}

// Back (Russian translation + extras) face — shared by both viewers.
function CardBack({ card }) {
  return (
    <div className="flashcard-face back">
      <span className="face-label">RU · Перевод</span>
      <h3 className="back-translation">{card.translation}</h3>
      {card.examples && card.examples[0] && (
        <div className="back-example">
          <p className="ex-en">{card.examples[0].en}</p>
          <p className="ex-ru">{card.examples[0].ru}</p>
        </div>
      )}
      {card.family && (
        <p className="back-family"><strong>Родственные формы:</strong> {card.family}</p>
      )}
    </div>
  )
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// The answer shown for a card depends on the quiz direction.
function answerOf(card, direction) {
  return direction === 'en-ru' ? card.translation : card.word
}

// Build the 4 choice values for one question: the correct answer + 3 distinct
// wrong answers drawn from other cards in the same set. If the set has fewer
// than 4 distinct possible answers, reduce gracefully to what's available.
function makeChoices(cards, cardIndex, direction) {
  const card = cards[cardIndex]
  const correct = answerOf(card, direction)
  const seen = new Set([correct])
  const wrongs = []
  cards.forEach((c, i) => {
    if (i === cardIndex) return
    const v = answerOf(c, direction)
    if (!seen.has(v)) {
      seen.add(v)
      wrongs.push(v)
    }
  })
  const pool = [correct, ...wrongs]
  if (wrongs.length < 3) return shuffle(pool) // fewer distinct answers available
  return shuffle([correct, ...shuffle(wrongs).slice(0, 3)])
}

// All selectable test question types (K7).
const QUESTION_TYPES = [
  { id: 'choice', label: 'Выбор ответа', desc: 'Вопрос + 4 варианта' },
  { id: 'typed', label: 'Ввод ответа', desc: 'Напечатать ответ с клавиатуры' },
  { id: 'matching', label: 'Сопоставление', desc: 'Соединить термины с переводами' },
  { id: 'tf', label: 'Правда/ложь', desc: 'Соответствуют ли слово и перевод' },
]

const ALL_TYPES = QUESTION_TYPES.map((t) => t.id)

// Build the prompt/answer side pair for a card under a given direction.
function sidesOf(card, direction) {
  return {
    q: direction === 'en-ru' ? card.word : card.translation,
    a: direction === 'en-ru' ? card.translation : card.word,
  }
}

// Random pick from an array.
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Build one question of a random selected type around a primary card index.
function buildQuestion(cards, cfg, cardIndex) {
  const dir = cfg.direction
  const types = cfg.types.length ? cfg.types : ALL_TYPES
  const type = pickOne(types)
  const card = cards[cardIndex]

  if (type === 'choice') {
    const { q, a } = sidesOf(card, dir)
    return { type, cardIndex, prompt: q, correct: a, choices: makeChoices(cards, cardIndex, dir) }
  }

  if (type === 'typed') {
    const { q, a } = sidesOf(card, dir)
    return { type, cardIndex, prompt: q, correct: a }
  }

  if (type === 'tf') {
    const { q } = sidesOf(card, dir)
    const truthful = Math.random() < 0.5
    // A 1-card set has no other card to draw a false statement from; fall back
    // to the card's own answer so presented is always defined (safe: it is
    // then truthful, so the answer is 'Да').
    const others = cards.filter((_, i) => i !== cardIndex)
    const other = others.length ? pickOne(others) : card
    const presented = truthful ? sidesOf(card, dir).a : sidesOf(other, dir).a
    return { type, cardIndex, prompt: q, presented, correct: truthful }
  }

  // matching: 4-6 terms on the left, shuffled answers on the right
  const mkLabel = (i) => (dir === 'en-ru' ? cards[i].word : cards[i].translation)
  const mkAnswer = (i) => (dir === 'en-ru' ? cards[i].translation : cards[i].word)
  const mcount = Math.min(6, Math.max(2, cards.length))
  const idxs = [cardIndex]
  const rest = shuffle(cards.map((_, i) => i).filter((i) => i !== cardIndex))
  for (const i of rest) {
    if (idxs.length >= mcount) break
    idxs.push(i)
  }
  const left = shuffle(idxs).map((i) => ({ idx: i, label: mkLabel(i) }))
  const right = shuffle(idxs.map((i) => ({ idx: i, label: mkAnswer(i) })))
  return { type, cardIndex, left, right, pairs: {} }
}

// K7 EXTENDED TEST -----------------------------------------------------------
// Configurable question types (choice/typed/matching/true-false), direction,
// question count and optional timer, with a score + error-breakdown result
// screen and a retry-on-errors pass.
function ExtendedTest({ set, id }) {
  const cards = set.cards
  const n = cards.length

  const [cfg, setCfg] = useState({
    types: [...ALL_TYPES],
    direction: 'en-ru',
    count: 'all', // 'all' | 'n'
    countN: Math.min(5, n),
    enableTimer: false,
    minutes: 5,
  })
  const [started, setStarted] = useState(false)
  const [run, setRun] = useState(null) // { pool, pos, target, score, wrong, streaks, done }
  const [question, setQuestion] = useState(null)
  const [feedback, setFeedback] = useState(false)
  const [pairs, setPairs] = useState({}) // matching: leftIdx -> rightIdx
  const [selLeft, setSelLeft] = useState(null) // matching: selected left idx
  const [secondsLeft, setSecondsLeft] = useState(null)

  const done = run ? run.done : false

  const makeQuestion = (pool, pos) => buildQuestion(cards, cfg, pool[pos])

  const start = () => {
    const allIdx = shuffle(cards.map((_, i) => i))
    const pool = cfg.count === 'all' ? allIdx : allIdx.slice(0, Math.min(cfg.countN, n))
    setRun({ pool, pos: 0, target: pool.length, score: 0, wrong: [], streaks: {}, done: false })
    setQuestion(makeQuestion(pool, 0))
    setSecondsLeft(cfg.enableTimer ? cfg.minutes * 60 : null)
    setFeedback(false)
    setPairs({})
    setSelLeft(null)
    setStarted(true)
  }

  // Optional countdown: when it hits zero, auto-finish the test.
  useEffect(() => {
    if (!started || !cfg.enableTimer || done || secondsLeft === null) return
    if (secondsLeft <= 0) {
      setRun((r) => ({ ...r, pos: r.target, done: true }))
      return
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [started, cfg.enableTimer, done, secondsLeft])

  // Apply the correct/wrong result of one answer to streaks + persistent status.
  const applyResult = (cardIndex, correct) => {
    setRun((r) => {
      const streaks = { ...r.streaks }
      const prev = streaks[String(cardIndex)] || 0
      const next = correct ? prev + 1 : 0
      streaks[String(cardIndex)] = next
      if (correct) setCardStatus(id, cardIndex, next >= 2 ? 'mastered' : 'learning')
      else setCardStatus(id, cardIndex, 'learning')
      return { ...r, streaks }
    })
  }

  const recordWrong = (entry) => {
    setRun((r) => ({ ...r, wrong: [...r.wrong, entry] }))
  }

  const finishAnswer = (cardIndex, correct, wrongEntry) => {
    setRun((r) => ({ ...r, score: r.score + (correct ? 1 : 0) }))
    applyResult(cardIndex, correct)
    if (!correct) recordWrong(wrongEntry)
    setFeedback(true)
  }

  const next = () => {
    const nextPos = run.pos + 1
    const doneNow = nextPos >= run.target
    setRun((r) => ({ ...r, pos: nextPos, done: doneNow }))
    // Only build the next question when the test is not over yet. When
    // nextPos reaches the target, run.pool[nextPos] is out of bounds and
    // buildQuestion(cards, cfg, undefined) would dereference cards[undefined]
    // and throw (K30: unhandled error on every completed test).
    if (!doneNow) setQuestion(makeQuestion(run.pool, nextPos))
    setFeedback(false)
    setPairs({})
    setSelLeft(null)
  }

  const retryWrong = () => {
    const wrongIdxs = run.wrong.map((w) => w.cardIndex)
    if (!wrongIdxs.length) return
    setRun({ pool: wrongIdxs, pos: 0, target: wrongIdxs.length, score: 0, wrong: [], streaks: {}, done: false })
    setQuestion(makeQuestion(wrongIdxs, 0))
    setSecondsLeft(null)
    setFeedback(false)
    setPairs({})
    setSelLeft(null)
  }

  // Matching counts as a single question: 1 point when every pair is correct.
  // Wrong pairs still get recorded for the error breakdown + retry (
  // and update statuses per involved card).
  const finishMatching = (correctIdxs, wrongEntries) => {
    setRun((r) => ({
      ...r,
      score: r.score + (wrongEntries.length ? 0 : 1),
      wrong: [...r.wrong, ...wrongEntries],
    }))
    correctIdxs.forEach((i) => applyResult(i, true))
    wrongEntries.forEach((w) => applyResult(w.cardIndex, false))
    setFeedback(true)
  }

  const restart = () => {
    setStarted(false)
    setRun(null)
    setQuestion(null)
    setFeedback(false)
    setSecondsLeft(null)
  }

  // ---- Settings screen (before start) ----
  // K27: register advance handler for Enter key in feedback phase.
  useEffect(() => {
    advanceRegistry.handler = feedback ? next : null
    return () => { if (advanceRegistry.handler === next) advanceRegistry.handler = null }
  }, [feedback, next])

  if (!started) {
    const toggleType = (tid) =>
      setCfg((c) => ({
        ...c,
        types: c.types.includes(tid) ? c.types.filter((t) => t !== tid) : [...c.types, tid],
      }))
    return (
      <div className="quiz test-settings">
        <h2 className="settings-title">Настройки теста</h2>

        <fieldset className="settings-block">
          <legend>Типы вопросов</legend>
          {QUESTION_TYPES.map((t) => (
            <label className="settings-check" key={t.id}>
              <input
                type="checkbox"
                checked={cfg.types.includes(t.id)}
                onChange={() => toggleType(t.id)}
              />
              <span className="settings-check-name">{t.label}</span>
              <span className="settings-check-desc">{t.desc}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="settings-block">
          <legend>Направление</legend>
          <div className="quiz-direction">
            <button
              type="button"
              role="tab"
              aria-selected={cfg.direction === 'en-ru'}
              className={'quiz-dir-btn' + (cfg.direction === 'en-ru' ? ' active' : '')}
              onClick={() => setCfg((c) => ({ ...c, direction: 'en-ru' }))}
            >
              en-ru
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={cfg.direction === 'ru-en'}
              className={'quiz-dir-btn' + (cfg.direction === 'ru-en' ? ' active' : '')}
              onClick={() => setCfg((c) => ({ ...c, direction: 'ru-en' }))}
            >
              ru-en
            </button>
          </div>
        </fieldset>

        <fieldset className="settings-block">
          <legend>Количество вопросов</legend>
          <div className="settings-row">
            <label className="settings-radio">
              <input
                type="radio"
                name="qcount"
                checked={cfg.count === 'all'}
                onChange={() => setCfg((c) => ({ ...c, count: 'all' }))}
              />
              Все <span className="muted">({n})</span>
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="qcount"
                checked={cfg.count === 'n'}
                onChange={() => setCfg((c) => ({ ...c, count: 'n' }))}
              />
              Только
              <input
                type="number"
                min="1"
                max={n}
                className="settings-num"
                value={cfg.countN}
                disabled={cfg.count !== 'n'}
                onChange={(e) => setCfg((c) => ({ ...c, countN: Number(e.target.value) }))}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="settings-block">
          <legend>Ограничение по времени</legend>
          <div className="settings-row">
            <label className="settings-check inline">
              <input
                type="checkbox"
                checked={cfg.enableTimer}
                onChange={() => setCfg((c) => ({ ...c, enableTimer: !c.enableTimer }))}
              />
              <span>Включить таймер</span>
            </label>
            <input
              type="number"
              min="1"
              className="settings-num"
              value={cfg.minutes}
              disabled={!cfg.enableTimer}
              onChange={(e) => setCfg((c) => ({ ...c, minutes: Number(e.target.value) }))}
            />
            <span className="muted">мин</span>
          </div>
        </fieldset>

        <button type="button" className="btn btn-primary settings-start" onClick={start}>
          Начать тест
        </button>
      </div>
    )
  }

  // ---- Result screen ----
  if (done) {
    const target = run.target
    const pct = target ? Math.round((run.score / target) * 100) : 0
    return (
      <div className="quiz quiz-result">
        <h2>Тест завершён</h2>
        <p className="quiz-result-score">{run.score} из {target} верно</p>
        <p className="quiz-result-pct">{pct}%</p>

        {run.wrong.length > 0 && (
          <div className="result-errors">
            <h3>Ошибки</h3>
            <ul>
              {run.wrong.map((w, i) => (
                <li key={i}>
                  <span className="re-prompt">{w.prompt}</span>
                  <span className="re-arrow">→</span>
                  <span className="re-correct">{w.correct}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="result-actions">
          {run.wrong.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={retryWrong}>
              Повторить ошибочные
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={restart}>
            Начать заново
          </button>
        </div>
      </div>
    )
  }

  const q = question
  const progress = run.target ? Math.min(run.pos / run.target, 1) : 0
  const mm = String(Math.floor((secondsLeft || 0) / 60)).padStart(2, '0')
  const ss = String((secondsLeft || 0) % 60).padStart(2, '0')

  return (
    <div className="quiz">
      <div className="quiz-meta">
        <span className="quiz-score">{run.score} / {run.pos} правильных</span>
        <span className="quiz-count">Вопрос {run.pos + 1} из {run.target}</span>
        {cfg.enableTimer && (
          <span className="quiz-timer" data-testid="quiz-timer">⏱ {mm}:{ss}</span>
        )}
      </div>
      <div className="quiz-progress">
        <div className="quiz-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      {q.type === 'choice' && (
        <ChoiceQuestion q={q} feedback={feedback} onAnswer={(cardIndex, correct, wrongEntry) => finishAnswer(cardIndex, correct, wrongEntry)} />
      )}
      {q.type === 'typed' && (
        <TypedQuestion q={q} feedback={feedback} onAnswer={finishAnswer} />
      )}
      {q.type === 'matching' && (
        <MatchingQuestion
          q={q}
          feedback={feedback}
          pairs={pairs}
          setPairs={setPairs}
          selLeft={selLeft}
          setSelLeft={setSelLeft}
          onCheck={finishMatching}
        />
      )}
      {q.type === 'tf' && (
        <TfQuestion q={q} feedback={feedback} onAnswer={finishAnswer} />
      )}

      {feedback && (
        <button type="button" className="btn btn-primary quiz-next" onClick={next}>
          Далее
        </button>
      )}
    </div>
  )
}

// Multiple choice question (classic K3 style + options).
function ChoiceQuestion({ q, feedback, onAnswer }) {
  const [picked, setPicked] = useState(null)
  const answer = (val) => {
    if (feedback) return
    setPicked(val)
    const correct = val === q.correct
    onAnswer(q.cardIndex, correct, { cardIndex: q.cardIndex, type: q.type, prompt: q.prompt, correct: q.correct })
  }
  // K23 (2): register the on-screen choice buttons as digit hotkeys (1..N in
  // DOM order) so pressing the digit triggers the exact same action as a click.
  useEffect(() => {
    answerRegistry.handlers = q.choices.map((val) => () => answer(val))
    return () => { answerRegistry.handlers = [] }
  }, [q, feedback])
  return (
    <>
      <div className="quiz-card">
        <span className="face-label">Выбор ответа</span>
        <h2 className="quiz-word">{q.prompt}</h2>
      </div>
      <div className="quiz-choices">
        {q.choices.map((val, i) => {
          let cls = 'quiz-choice'
          if (feedback && val === q.correct) cls += ' correct'
          if (feedback && val === picked && val !== q.correct) cls += ' wrong'
          return (
            <button key={i} type="button" className={cls} disabled={feedback} onClick={() => answer(val)}>
              {i < 4 && <span className="choice-digit">{i + 1}</span>}
              {val}
            </button>
          )
        })}
      </div>
    </>
  )
}

// Typed active-recall question.
function TypedQuestion({ q, feedback, onAnswer }) {
  const [input, setInput] = useState('')
  const submit = () => {
    if (feedback) return
    const correct = matchAnswer(input, q.correct)
    onAnswer(q.cardIndex, correct, { cardIndex: q.cardIndex, type: q.type, prompt: q.prompt, correct: q.correct })
  }
  return (
    <>
      <div className="quiz-card">
        <span className="face-label">Ввод ответа</span>
        <h2 className="quiz-word">{q.prompt}</h2>
      </div>
      <form
        className="write-form"
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        <input
          className="write-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Введите ответ…"
          value={input}
          disabled={feedback}
          onChange={(e) => setInput(e.target.value)}
          data-testid="typed-input"
        />
        {!feedback && (
          <div className="write-actions">
            <button type="button" className="btn btn-primary" onClick={submit}>
              Проверить
            </button>
          </div>
        )}
      </form>
      {feedback && (
        <div className={'study-feedback ' + (matchAnswer(input, q.correct) ? 'correct' : 'wrong')}>
          {matchAnswer(input, q.correct)
            ? 'Верно!'
            : <>Неверно. Правильный ответ: <strong>{q.correct}</strong></>}
        </div>
      )}
    </>
  )
}

// True/false question: does the shown word match its translation?
function TfQuestion({ q, feedback, onAnswer }) {
  const [picked, setPicked] = useState(null)
  const answer = (val) => {
    if (feedback) return
    setPicked(val)
    const correct = val === q.correct
    onAnswer(q.cardIndex, correct, { cardIndex: q.cardIndex, type: q.type, prompt: q.prompt, correct: `${q.prompt} = ${q.presented}` })
  }
  return (
    <>
      <div className="quiz-card">
        <span className="face-label">Правда/ложь</span>
        <h2 className="quiz-word">{q.prompt}</h2>
        <p className="tf-statement">{q.presented}</p>
      </div>
      <div className="tf-actions">
        <button type="button" className={'tf-btn' + (picked === true ? ' picked' : '')} disabled={feedback} onClick={() => answer(true)}>
          ✔ Да
        </button>
        <button type="button" className={'tf-btn' + (picked === false ? ' picked' : '')} disabled={feedback} onClick={() => answer(false)}>
          ✘ Нет
        </button>
      </div>
      {feedback && picked !== null && (
        <div className={'study-feedback ' + (picked === q.correct ? 'correct' : 'wrong')}>
          {picked === q.correct ? 'Верно!' : <>Неверно. Ответ: <strong>{q.correct ? 'Да' : 'Нет'}</strong></>}
        </div>
      )}
    </>
  )
}

// Matching question: pair terms on the left with shuffled translations on the
// right by clicking a left item then a right item, then finalize.
function MatchingQuestion({ q, feedback, pairs, setPairs, selLeft, setSelLeft, onCheck }) {
  const [matchedCorrect, setMatchedCorrect] = useState(0)
  const leftAllPaired = q.left.every((l) => pairs[l.idx] !== undefined)
  const check = () => {
    if (feedback) return
    let correctCount = 0
    const correctIdxs = []
    const wrongEntries = []
    for (const l of q.left) {
      const rIdx = pairs[l.idx]
      if (rIdx === undefined) continue
      if (l.idx === rIdx) {
        correctCount += 1
        correctIdxs.push(l.idx)
      } else {
        wrongEntries.push({ cardIndex: l.idx, type: 'matching', prompt: l.label, correct: q.right.find((r) => r.idx === l.idx).label })
      }
    }
    setMatchedCorrect(correctCount)
    onCheck(correctIdxs, wrongEntries)
    setSelLeft(null)
  }
  // K27: register check handler for Enter when all pairs made, no feedback.
  useEffect(() => {
    advanceRegistry.handler = (!feedback && leftAllPaired) ? check : null
    return () => { if (advanceRegistry.handler === check) advanceRegistry.handler = null }
  }, [feedback, leftAllPaired, check])
  return (
    <>
      <div className="quiz-card match-head">
        <span className="face-label">Сопоставление</span>
        <p className="match-desc">{q.left.length} пар. Нажмите слева, затем справа.</p>
      </div>
      <div className="match-board">
        <div className="match-col">
          {q.left.map((l) => {
            const matched = pairs[l.idx]
            const isSel = selLeft === l.idx
            let cls = 'match-item left' + (isSel ? ' selected' : '') + (matched !== undefined ? ' matched' : '')
            if (feedback && matched !== undefined) cls += matched === l.idx ? ' ok' : ' bad'
            return (
              <button
                key={'L' + l.idx}
                type="button"
                className={cls}
                data-cardidx={l.idx}
                disabled={feedback}
                onClick={() => setSelLeft(isSel ? null : l.idx)}
              >
                <span className="match-label">{l.label}</span>
                {matched !== undefined && (
                  <span className="match-link">→ {q.right.find((r) => r.idx === matched).label}</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="match-col">
          {q.right.map((r) => {
            const usedBy = Object.keys(pairs).find((k) => pairs[k] === r.idx)
            let cls = 'match-item right' + (usedBy !== undefined ? ' used' : '')
            if (feedback && usedBy !== undefined) cls += String(r.idx) === usedBy ? ' ok' : ' bad'
            return (
              <button
                key={'R' + r.idx}
                type="button"
                className={cls}
                data-cardidx={r.idx}
                disabled={feedback || usedBy !== undefined}
                onClick={() => {
                  if (selLeft === null) return
                  setPairs((p) => ({ ...p, [selLeft]: r.idx }))
                  setSelLeft(null)
                }}
              >
                <span className="match-label">{r.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {!feedback && leftAllPaired && (
        <button type="button" className="btn btn-primary quiz-next" onClick={check}>
          Проверить пары
        </button>
      )}
      {feedback && (
        <div className="study-feedback matching-feedback">
          Правильных пар: {matchedCorrect} из {q.left.length}
        </div>
      )}
    </>
  )
}

// K6 study (Learn/Write) shared helpers ------------------------------------------

// Adaptive work order for a set: not-yet-mastered cards first, then mastered;
// among non-mastered, learning-status cards (had an error) ahead of not_studied,
// then fewest view-count first; stable tiebreak by card index.
const STATUS_RANK = { learning: 0, not_studied: 1, mastered: 2 }

function adaptiveOrder(id, cards) {
  const statuses = getStatuses(id)
  const idxs = cards.map((_, i) => i)
  return [...idxs].sort((a, b) => {
    const ra = STATUS_RANK[statuses[String(a)] || 'not_studied']
    const rb = STATUS_RANK[statuses[String(b)] || 'not_studied']
    if (ra !== rb) return ra - rb
    const va = getViews(id, a)
    const vb = getViews(id, b)
    if (va !== vb) return va - vb
    return a - b
  })
}

// K9 spaced-repetition review order: cards due at-or-before today come first
// (with the 'к повторению' marker), the rest follow — each group keeping the
// adaptive (K6) ordering inside it.
function reviewOrder(id, cards) {
  const statuses = getStatuses(id)
  const idxs = cards.map((_, i) => i)
  return [...idxs].sort((a, b) => {
    const da = isDueOn(id, a, todayStr()) ? 0 : 1
    const db = isDueOn(id, b, todayStr()) ? 0 : 1
    if (da !== db) return da - db
    const ra = STATUS_RANK[statuses[String(a)] || 'not_studied']
    const rb = STATUS_RANK[statuses[String(b)] || 'not_studied']
    if (ra !== rb) return ra - rb
    const va = getViews(id, a)
    const vb = getViews(id, b)
    if (va !== vb) return va - vb
    return a - b
  })
}

// Initial work queue excludes mastered cards and is ordered for K9 reviews.
function initialQueue(id, cards) {
  return reviewOrder(id, cards).filter((i) => getStatus(id, i) !== 'mastered')
}

// Number of cards due at-or-before today (drives the 'no reviews today' screen).
function dueCount(id, cards) {
  return cards.reduce((acc, _, i) => acc + (isDueOn(id, i, todayStr()) ? 1 : 0), 0)
}

function countMastered(id, cards) {
  return cards.reduce((acc, _, i) => acc + (getStatus(id, i) === 'mastered' ? 1 : 0), 0)
}

// Shared state machine for Learn (multiple choice) and Write (typed input).
// Tracks a per-session consecutive-correct streak per card: 2 in a row -> mastered,
// any error -> learning. Queue is advanced on `advance()`; mastered cards leave the
// queue, un-mastered ones go back to the end so difficult cards get repeated.
// Accepts optional external direction/setDirection so the parent (SetPage) can
// own the direction state and bind it to the settings panel.
function useStudySession(set, id, externalDirection, externalSetDirection) {
  const cards = set.cards
  const n = cards.length
  const [direction, setDirection] = externalDirection !== undefined
    ? [externalDirection, externalSetDirection]
    : useState('en-ru')
  const [queue, setQueue] = useState(() => initialQueue(id, cards))
  const [streaks, setStreaks] = useState({})
  const [masteredCount, setMasteredCount] = useState(() => countMastered(id, cards))
  const [running, setRunning] = useState(queue.length > 0)
  const [startedWithDue, setStartedWithDue] = useState(() => dueCount(id, cards) > 0)

  const idx = running && queue.length ? queue[0] : -1
  const card = idx >= 0 ? cards[idx] : null

  // Apply a correct/wrong result to the current card's status + streak,
  // plus the K9 spaced-repetition schedule and daily study mark.
  const applyResult = (correct) => {
    const i = queue[0]
    recordStudyDay()
    applySrsAnswer(id, i, correct)
    const s = { ...streaks }
    if (correct) {
      const ns = (s[i] || 0) + 1
      s[i] = ns
      if (ns >= 2) {
        setCardStatus(id, i, 'mastered')
        setMasteredCount((c) => c + 1)
      } else {
        setCardStatus(id, i, 'learning')
      }
    } else {
      s[i] = 0
      setCardStatus(id, i, 'learning')
    }
    setStreaks(s)
  }

  // Advance to the next card; mastered ones leave the queue, others cycle to the end.
  const advance = () => {
    const i = queue[0]
    const cleaned = queue.filter((x) => x !== i)
    const mastered = (streaks[i] || 0) >= 2
    const nextQueue = mastered ? cleaned : [...cleaned, i]
    if (nextQueue.length === 0) {
      setQueue([])
      setRunning(false)
    } else {
      setQueue(nextQueue)
    }
  }

  const restart = () => {
    const q = initialQueue(id, cards)
    setStreaks({})
    setQueue(q)
    setRunning(q.length > 0)
    setStartedWithDue(dueCount(id, cards) > 0)
    setMasteredCount(countMastered(id, cards))
  }

  // K10: randomize the work order for the current pass (keeps the queue intact).
  const shuffleNow = () => setQueue((q) => (q.length ? shuffle(q) : q))

  return {
    direction, setDirection, idx, card, masteredCount, n, running, startedWithDue,
    applyResult, advance, restart, shuffleNow,
  }
}

// Progress bar + mastered counter, shared by Learn/Write.
function StudyProgress({ mastered, total }) {
  const pct = total ? Math.round((mastered / total) * 100) : 0
  return (
    <div className="study-progress">
      <div className="quiz-progress" style={{ width: '100%' }}>
        <div className="quiz-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="study-progress-label">Освоено {mastered} из {total}</span>
    </div>
  )
}

// Shared "session finished" result block.
function StudyDone({ label, onRestart }) {
  return (
    <div className="quiz quiz-result">
      <h2>{label}</h2>
      <p className="quiz-result-pct">Все карточки освоены 🎉</p>
      <button type="button" className="btn btn-primary" onClick={onRestart}>
        Начать заново
      </button>
    </div>
  )
}

// K9: no cards due today -> spaced-repetition "done for the day" screen.
function NoReviews({ onRestart }) {
  return (
    <div className="quiz quiz-result no-reviews" data-testid="no-reviews">
      <h2>Повторений на сегодня нет</h2>
      <p className="quiz-result-pct">Вы закончили повторения на сегодня. Возвращайтесь завтра! ✨</p>
      <button type="button" className="btn btn-primary" onClick={onRestart}>
        Проверить снова
      </button>
    </div>
  )
}

// K6 LEARN (adaptive multiple choice) -------------------------------------------
function Learn({ set, id }) {
  const s = useStudySession(set, id)
  const { direction, setDirection, card, masteredCount, n, running } = s
  const [phase, setPhase] = useState('question')
  const [picked, setPicked] = useState(null)
  const [result, setResult] = useState(null) // 'correct' | 'wrong'

  const choices = useMemo(
    () => (card ? makeChoices(set.cards, s.idx, direction) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, direction, s.idx]
  )

  const correct = card ? answerOf(card, direction) : ''
  const prompt = card ? (direction === 'en-ru' ? card.word : card.translation) : ''

  const choose = (val) => {
    if (phase !== 'question') return
    setPicked(val)
    const isCorrect = val === correct
    setResult(isCorrect ? 'correct' : 'wrong')
    s.applyResult(isCorrect)
    setPhase('feedback')
  }

  const next = () => {
    s.advance()
    setPhase('question')
    setPicked(null)
    setResult(null)
  }

  // K23 (2): digits 1..N click the visible Learn choices (DOM order).
  useEffect(() => {
    if (phase !== 'question') { answerRegistry.handlers = []; return }
    answerRegistry.handlers = choices.map((val) => () => choose(val))
    return () => { answerRegistry.handlers = [] }
  }, [choices, phase])

  // K27: register advance handler for Enter key in feedback phase.
  useEffect(() => {
    advanceRegistry.handler = phase === 'feedback' ? next : null
    return () => { if (advanceRegistry.handler === next) advanceRegistry.handler = null }
  }, [phase, next])

  // K27: register shuffle handler for settings-panel shuffle button.
  useEffect(() => {
    studyRegistry.shuffleNow = running ? s.shuffleNow : null
    return () => { if (studyRegistry.shuffleNow === s.shuffleNow) studyRegistry.shuffleNow = null }
  }, [running, s.shuffleNow])

  if (masteredCount >= n) {
    return <StudyDone label="Обучение завершено" onRestart={s.restart} />
  }
  if (!s.startedWithDue) {
    return <NoReviews onRestart={s.restart} />
  }
  if (!running) {
    return <StudyDone label="Обучение завершено" onRestart={s.restart} />
  }

  return (
    <div className="quiz study">
      <StudyProgress mastered={masteredCount} total={n} />

      <div className="quiz-card">
        <span className="face-label">{direction === 'en-ru' ? 'EN · Слово' : 'RU · Перевод'}</span>
        <h2 className="quiz-word study-prompt">{prompt}</h2>
        <span className="study-status">{getStatus(id, s.idx)}</span>
        {isDueOn(id, s.idx, todayStr()) && <span className="review-badge inline">к повторению</span>}
      </div>

      <div className="quiz-choices">
        {choices.map((val, i) => {
          let cls = 'quiz-choice'
          if (phase === 'feedback' && val === correct) cls += ' correct'
          if (phase === 'feedback' && val === picked && val !== correct) cls += ' wrong'
          return (
            <button key={i} type="button" className={cls} disabled={phase === 'feedback'} onClick={() => choose(val)}>
              {i < 4 && <span className="choice-digit">{i + 1}</span>}
              {val}
            </button>
          )
        })}
      </div>

      {phase === 'feedback' && (
        <>
          <div className={'study-feedback ' + result}>
            {result === 'correct' ? 'Верно!' : <>Неверно. Правильный ответ: <strong>{correct}</strong></>}
          </div>
          <button type="button" className="btn btn-primary quiz-next" onClick={next}>
            Далее
          </button>
        </>
      )}
    </div>
  )
}

// K6 WRITE (typed active recall) --------------------------------------------------
function Write({ set, id, studyDirection, setStudyDirection }) {
  const s = useStudySession(set, id, studyDirection, setStudyDirection)
  const { direction, setDirection, card, masteredCount, n, running } = s
  const [input, setInput] = useState('')
  const inputRef = useRef(null)
  const [phase, setPhase] = useState('question')
  const [result, setResult] = useState(null)

  // K27: autofocus input when transitioning to question phase.
  useEffect(() => {
    if (phase === 'question' && inputRef.current) inputRef.current.focus()
  }, [phase])

  const prompt = card ? (direction === 'en-ru' ? card.word : card.translation) : ''
  const correct = card ? (direction === 'en-ru' ? card.translation : card.word) : ''

  const submit = (given) => {
    if (phase !== 'question') return
    const isCorrect = matchAnswer(given === undefined ? input : given, correct)
    setResult(isCorrect ? 'correct' : 'wrong')
    s.applyResult(isCorrect)
    setPhase('feedback')
  }

  const next = () => {
    s.advance()
    setPhase('question')
    setInput('')
    setResult(null)
  }

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (phase === 'question') submit()
      else next()
    }
  }

  // K27: register advance handler for Enter key in feedback phase.
  useEffect(() => {
    advanceRegistry.handler = phase === 'feedback' ? next : null
    return () => { if (advanceRegistry.handler === next) advanceRegistry.handler = null }
  }, [phase, next])

  // K27: register shuffle handler for settings-panel shuffle button.
  useEffect(() => {
    studyRegistry.shuffleNow = running ? s.shuffleNow : null
    return () => { if (studyRegistry.shuffleNow === s.shuffleNow) studyRegistry.shuffleNow = null }
  }, [running, s.shuffleNow])

  if (!running) {
    return <StudyDone label="Написание завершено" onRestart={s.restart} />
  }

  return (
    <div className="quiz study">
      <StudyProgress mastered={masteredCount} total={n} />

      <div className="quiz-card">
        <span className="face-label">{direction === 'en-ru' ? 'EN · Слово' : 'RU · Перевод'}</span>
        <h2 className="quiz-word study-prompt">{prompt}</h2>
      </div>

      <form className="write-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input
          ref={inputRef}
          className="write-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Введите ответ…"
          value={input}
          disabled={phase === 'feedback'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          autoFocus
        />
        {phase === 'question' && (
          <div className="write-actions">
            <button type="button" className="btn btn-primary" onClick={() => submit()}>
              Проверить
            </button>
            <button type="button" className="btn btn-outline" onClick={() => submit('')}>
              Не помню
            </button>
          </div>
        )}
      </form>

      {phase === 'feedback' && (
        <>
          <div className={'study-feedback ' + result}>
            {result === 'correct'
              ? `Верно! ${correct}`
              : <>Неверно. Правильный ответ: <strong>{correct}</strong></>}
          </div>
          <button type="button" className="btn btn-primary quiz-next" onClick={next}>
            Далее
          </button>
        </>
      )}
    </div>
  )
}

// K7 SPELL (audio + typed spelling) -------------------------------------------
// Speak the English word via the Web Speech API and have the user type it back.
// Picks an en voice when available; degrades gracefully (try/catch) if speech
// synthesis is unavailable (e.g. headless Chromium) so typing still works.
let _speechVoices = []
function loadVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    _speechVoices = window.speechSynthesis.getVoices()
  } catch (e) {
    _speechVoices = []
  }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices()
  try { window.speechSynthesis.onvoiceschanged = loadVoices } catch (e) { /* ignore */ }
}

function speakEnglish(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    const en =
      _speechVoices.find((v) => /^en/i.test(v.lang)) ||
      _speechVoices.find((v) => /\ben(?:[-_]|$)/i.test(v.lang)) ||
      _speechVoices.find((v) => /en/i.test(v.name)) ||
      null
    if (en) utter.voice = en
    utter.lang = 'en-US'
    synth.speak(utter)
  } catch (e) {
    // speech unavailable -> UI still works, user can type the word
  }
}

// K7 SPELL mode: hear the word, type it letter-by-letter. Reuses the adaptive
// session machine so statuses follow the same correct-2x->mastered semantics.
function Spell({ set, id, studyDirection, setStudyDirection }) {
  const s = useStudySession(set, id, studyDirection, setStudyDirection)
  const { card, masteredCount, n, running } = s
  const [input, setInput] = useState('')
  const inputRef = useRef(null)
  const [phase, setPhase] = useState('question')
  const [result, setResult] = useState(null)

  // K27: autofocus input when transitioning to question phase.
  useEffect(() => {
    if (phase === 'question' && inputRef.current) inputRef.current.focus()
  }, [phase])

  const word = card ? card.word : ''
  const hint = card ? card.word.charAt(0) : ''
  const correct = card ? card.word : ''

  // Speak each new word as it appears (and on repeat via the button).
  useEffect(() => {
    if (running && word) speakEnglish(word)
  }, [running, word])

  const submit = (given) => {
    if (phase !== 'question') return
    const isCorrect = matchAnswer(given === undefined ? input : given, correct)
    setResult(isCorrect ? 'correct' : 'wrong')
    s.applyResult(isCorrect)
    setPhase('feedback')
  }

  const next = () => {
    s.advance()
    setPhase('question')
    setInput('')
    setResult(null)
  }

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (phase === 'question') submit()
      else next()
    }
  }

  // K27: register advance handler for Enter key in feedback phase.
  useEffect(() => {
    advanceRegistry.handler = phase === 'feedback' ? next : null
    return () => { if (advanceRegistry.handler === next) advanceRegistry.handler = null }
  }, [phase, next])

  // K27: register shuffle handler for settings-panel shuffle button.
  useEffect(() => {
    studyRegistry.shuffleNow = running ? s.shuffleNow : null
    return () => { if (studyRegistry.shuffleNow === s.shuffleNow) studyRegistry.shuffleNow = null }
  }, [running, s.shuffleNow])

  if (!running) {
    return <StudyDone label="Spell завершён" onRestart={s.restart} />
  }

  return (
    <div className="quiz study spell">
      <StudyProgress mastered={masteredCount} total={n} />

      <div className="quiz-card">
        <span className="face-label">Spell · Наберите услышанное слово</span>
        <h2 className="quiz-word spell-speaker">🔊</h2>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => speakEnglish(word)}
          data-testid="spell-repeat"
        >
          Повторить озвучку
        </button>
        {phase === 'question' && <span className="spell-hint">Первая буква: <strong>{hint}</strong></span>}
      </div>

      <form className="write-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input
          ref={inputRef}
          className="write-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder="Введите слово…"
          value={input}
          disabled={phase === 'feedback'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          data-testid="spell-input"
          data-answer={correct}
          autoFocus
        />
        {phase === 'question' && (
          <div className="write-actions">
            <button type="button" className="btn btn-primary" onClick={() => submit()}>
              Проверить
            </button>
            <button type="button" className="btn btn-outline" onClick={() => submit('')}>
              Не помню
            </button>
          </div>
        )}
      </form>

      {phase === 'feedback' && (
        <>
          <div className={'study-feedback ' + result}>
            {result === 'correct'
              ? `Верно! ${correct}`
              : <>Неверно. Правильное слово: <strong>{correct}</strong></>}
          </div>
          <button type="button" className="btn btn-primary quiz-next" onClick={next}>
            Далее
          </button>
        </>
      )}
    </div>
  )
}

// K8 shared status tracker ----------------------------------------------------
// Tracks a per-card consecutive-correct streak so Match/Blast promote to
// 'mastered' (2 correct in a row) and demote any error to 'learning', mirroring
// the K6/K7 useStudySession semantics exactly.
function useStatusTracker(setId) {
  const [streaks, setStreaks] = useState({})
  const applyResult = (cardIndex, correct) => {
    recordStudyDay()
    applySrsAnswer(setId, cardIndex, correct)
    setStreaks((s) => {
      const prev = s[String(cardIndex)] || 0
      const next = correct ? prev + 1 : 0
      if (correct) setCardStatus(setId, cardIndex, next >= 2 ? 'mastered' : 'learning')
      else setCardStatus(setId, cardIndex, 'learning')
      return { ...s, [String(cardIndex)]: next }
    })
  }
  return { applyResult }
}

// K8 MATCH (timed pairing + best-time records) --------------------------------
// Shuffles up to 8 (or all) cards into two columns — terms and their translations.
// The player clicks a term then its translation to pair them; paired cards lock.
// Completing every pair stops the timer and shows the elapsed time, persisting a
// best time under "fc_records_<setId>" when it beats the stored record.
function fmtMs(ms) {
  const totalSec = ms / 1000
  if (totalSec < 60) return totalSec.toFixed(1) + ' с'
  const m = Math.floor(totalSec / 60)
  const s = (totalSec % 60).toFixed(1)
  return m + ':' + String(s).padStart(4, '0')
}

function Match({ set, id }) {
  const cards = set.cards
  const n = cards.length
  const LIMIT = Math.min(8, n)

  const [phase, setPhase] = useState('start') // 'start' | 'playing' | 'done'
  const [puzzle, setPuzzle] = useState({ terms: [], trans: [] })
  const [pairs, setPairs] = useState({}) // termIdx -> transIdx
  const [selected, setSelected] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [startAt, setStartAt] = useState(0)
  const [newRecord, setNewRecord] = useState(false)
  const [best, setBest] = useState(() => getRecord(id))

  const { applyResult } = useStatusTracker(id)

  const start = () => {
    const chosen = shuffle(cards.map((_, i) => i)).slice(0, LIMIT)
    setPuzzle({
      terms: chosen.map((i) => ({ idx: i, label: cards[i].word })),
      trans: shuffle(chosen.map((i) => ({ idx: i, label: cards[i].translation }))),
    })
    setPairs({})
    setSelected(null)
    setElapsed(0)
    setStartAt(Date.now())
    setNewRecord(false)
    setPhase('playing')
  }

  // Timer runs while playing.
  useEffect(() => {
    if (phase !== 'playing') return
    const t = setInterval(() => setElapsed(Date.now() - startAt), 50)
    return () => clearInterval(t)
  }, [phase, startAt])

  const pairCount = Object.keys(pairs).length
  const allPaired = puzzle.terms.length > 0 && pairCount === puzzle.terms.length

  // Finish when the last pair is placed: freeze the time and persist the record.
  useEffect(() => {
    if (phase !== 'playing' || !allPaired) return
    const finalElapsed = Date.now() - startAt
    setElapsed(finalElapsed)
    const isNew = saveRecord(id, finalElapsed)
    // K20: share a new best Match time with the server leaderboard (nickname).
    if (isNew) pushLeaderboard(id, 'match', finalElapsed)
    setNewRecord(isNew)
    setBest(getRecord(id))
    setPhase('done')
  }, [allPaired, phase, startAt, id])

  const onSelectTerm = (idx) => {
    if (phase !== 'playing' || pairs[idx] !== undefined) return
    setSelected(selected === idx ? null : idx)
  }

  const onSelectTrans = (idx) => {
    if (phase !== 'playing' || selected === null) return
    if (pairs[selected] !== undefined || pairs[idx] !== undefined) return
    if (idx === selected) {
      // Correct pair: closer to mastered + count the view.
      recordCardView(id, selected)
      applyResult(selected, true)
      setPairs((p) => ({ ...p, [selected]: idx }))
      setSelected(null)
    } else {
      // Wrong pairing attempt for the selected term -> learning.
      recordCardView(id, selected)
      applyResult(selected, false)
      setSelected(null)
    }
  }

  // K23 (4): register Match's keyboard pairing while playing. A digit selects a
  // row in the LEFT (term) column; a letter a.. selects a row in the RIGHT
  // (trans) column. Order and swapping are both supported ("2a" == "a2"). When a
  // digit AND a letter are present the pair is placed exactly like clicking the
  // term card then its translation. Re-registered whenever the puzzle or
  // placed pairs change so the handler always sees fresh state.
  useEffect(() => {
    if (phase !== 'playing') {
      matchRegistry.active = false
      matchRegistry.handle = null
      return
    }
    matchRegistry.active = true
    let buf = {}
    matchRegistry.handle = (k) => {
      let consumed = false
      if (/^[1-9]$/.test(k)) {
        const row = Number(k) - 1
        if (row < puzzle.terms.length) { buf.digit = row; consumed = true }
      } else if (/^[a-z]$/.test(k)) {
        const col = k.charCodeAt(0) - 97
        if (col < puzzle.trans.length) { buf.letter = col; consumed = true }
      }
      if (buf.digit !== undefined && buf.letter !== undefined) {
        const d = buf.digit, l = buf.letter
        buf = {}
        const term = puzzle.terms[d]
        const trans = puzzle.trans[l]
        if (term && trans) {
          const termIdx = term.idx
          const transIdx = trans.idx
          if (pairs[termIdx] === undefined && pairs[transIdx] === undefined) {
            recordCardView(id, termIdx)
            if (transIdx === termIdx) {
              // Correct pair.
              applyResult(termIdx, true)
              setPairs((p) => ({ ...p, [termIdx]: transIdx }))
            } else {
              // Wrong pairing attempt for the selected term -> learning.
              applyResult(termIdx, false)
            }
            setSelected(null)
          }
        }
      }
      return consumed
    }
    return () => { matchRegistry.active = false; matchRegistry.handle = null }
  }, [phase, puzzle, pairs])

  if (phase === 'start') {
    return (
      <div className="quiz match">
        <div className="quiz-card match-intro">
          <span className="face-label">Match · На время</span>
          <h2 className="quiz-word">Сопоставьте термины и переводы</h2>
          <p className="match-desc">
            Нажмите на термин, затем на его перевод, чтобы соединить пару. Цель —
            {LIMIT} пар за минимальное время.
          </p>
        </div>
        {best && <div className="blast-best">Лучший результат: <strong>{fmtMs(best.ms)}</strong></div>}
        <button type="button" className="btn btn-primary" onClick={start}>Начать</button>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="quiz quiz-result match-result">
        <h2>Готово! 🎉</h2>
        <p className="quiz-result-score">{fmtMs(elapsed)}</p>
        {newRecord && <p className="match-record-new">🏆 Новый рекорд!</p>}
        <p className="match-record">Лучший результат: <strong>{best ? fmtMs(best.ms) : '—'}</strong></p>
        <div className="result-actions">
          <button type="button" className="btn btn-primary" onClick={start}>Ещё раз</button>
        </div>
      </div>
    )
  }

  return (
    <div className="quiz match-match">
      <div className="quiz-meta">
        <span className="match-timer">⏱ {fmtMs(elapsed)}</span>
        <span className="match-count">Осталось пар: {puzzle.terms.length - pairCount}</span>
      </div>
      <div className="match-grid">
        <div className="match-col">
          {puzzle.terms.map((t, r) => {
            const isPaired = pairs[t.idx] !== undefined
            let cls = 'match-card term' + (isPaired ? ' paired' : '') + (selected === t.idx ? ' selected' : '')
            return (
              <button key={'t' + t.idx} type="button" className={cls} data-cardidx={t.idx} disabled={isPaired} onClick={() => onSelectTerm(t.idx)}>
                {r < 9 && <span className="choice-digit match-digit">{r + 1}</span>}
                {t.label}
              </button>
            )
          })}
        </div>
        <div className="match-col">
          {puzzle.trans.map((t, r) => {
            const usedBy = Object.keys(pairs).find((k) => pairs[k] === t.idx)
            const cls = 'match-card trans' + (usedBy !== undefined ? ' paired' : '')
            return (
              <button key={'r' + t.idx} type="button" className={cls} data-cardidx={t.idx} disabled={usedBy !== undefined} onClick={() => onSelectTrans(t.idx)}>
                {r < 26 && <span className="choice-digit match-letter">{String.fromCharCode(97 + r)}</span>}
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// K8 BLAST (arcade block game) ------------------------------------------------
// A term sits in the center while floating blocks offer translation options.
// Click the correct one to score; a wrong click costs a heart and a score point.
// Levels get harder (more blocks, faster float). The run ends when the player
// clears all levels (win) or runs out of hearts (game over).
const BLAST_LEVELS = 3

function Blast({ set, id }) {
  const cards = set.cards
  const n = cards.length

  const [phase, setPhase] = useState('start') // 'start' | 'playing' | 'done'
  const [level, setLevel] = useState(1)
  const [answered, setAnswered] = useState(0) // rounds done in the current level
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [pool, setPool] = useState([])
  const [poolPos, setPoolPos] = useState(0)
  const [qidx, setQidx] = useState(-1)
  const [blocks, setBlocks] = useState([])
  const [feedback, setFeedback] = useState(null) // 'correct' | 'wrong' | null
  const [result, setResult] = useState(null) // 'win' | 'gameover' | null
  // K26: full-screen green flash shown while a correct answer auto-advances.
  const [flash, setFlash] = useState(false)
  const flashTimerRef = useRef(null)

  const { applyResult } = useStatusTracker(id)

  // K26: latest live game state for the delayed auto-advance timer, so the
  // timeout callback never operates on a stale level/pool/poolPos closure.
  const blastState = useRef({ phase, level, pool, poolPos })
  blastState.current = { phase, level, pool, poolPos }

  // K26: single shared timer for the correct-answer auto-advance.
  const clearBlastFlash = () => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
  }
  // Make sure a pending flash timer never fires after the component unmounts.
  useEffect(() => () => clearBlastFlash(), [])

  // K11: persist the best Blast score so it can appear on the leaderboard.
  useEffect(() => {
    if (phase !== 'done') return
    // K20: share a new Blast best with the server leaderboard (nickname).
    if (saveBlastScore(id, score)) pushLeaderboard(id, 'blast', score)
  }, [phase, id, score])

  const roundsPerLevel = (lvl) => Math.min(3 + lvl, n)

  const buildBlocks = (cardIdx, lvl) => {
    const correctLabel = cards[cardIdx].translation
    const count = Math.min(3 + lvl, n)
    const others = shuffle(cards.map((_, i) => i).filter((i) => i !== cardIdx && cards[i].translation !== correctLabel))
    const dist = others.slice(0, count - 1).map((i) => ({ idx: i, label: cards[i].translation, correct: false }))
    return shuffle([{ idx: cardIdx, label: correctLabel, correct: true }, ...dist])
  }

  const launch = (p, pos, lvl) => {
    const idx = p[pos % p.length]
    setQidx(idx)
    setBlocks(buildBlocks(idx, lvl))
  }

  const start = () => {
    clearBlastFlash()
    setFlash(false)
    const p = shuffle(cards.map((_, i) => i))
    setLevel(1)
    setAnswered(0)
    setScore(0)
    setLives(3)
    setPool(p)
    setPoolPos(0)
    setFeedback(null)
    setResult(null)
    setQidx(p[0])
    setBlocks(buildBlocks(p[0], 1))
    setPhase('playing')
  }

  const answer = (block) => {
    if (phase !== 'playing' || feedback) return
    recordCardView(id, qidx)
    const lvl = level
    const rls = roundsPerLevel(lvl)
    const nextAnswered = answered + 1
    const levelDone = nextAnswered >= rls
    const isCorrect = block.correct
    setFeedback(isCorrect ? 'correct' : 'wrong')
    if (isCorrect) {
      applyResult(qidx, true)
      setScore((s) => s + 1)
      // K26: correct -> green flash + auto-advance 600ms later (NO manual click).
      setFlash(true)
      clearBlastFlash()
      flashTimerRef.current = setTimeout(() => {
        flashTimerRef.current = null
        setFlash(false)
        advance()
      }, 600)
    } else {
      applyResult(qidx, false)
      setScore((s) => Math.max(0, s - 1))
      const nl = lives - 1
      setLives(nl)
      if (nl <= 0) { setResult('gameover'); setPhase('done'); return }
    }
    // Scoring / lives / level / win / gameover always fire exactly ONCE here.
    if (levelDone) {
      if (lvl >= BLAST_LEVELS) { setResult('win'); setPhase('done'); return }
      setLevel(lvl + 1)
      setAnswered(0)
    } else {
      setAnswered(nextAnswered)
    }
  }

  // The single progression step (advance to the next question). Reads live
  // state from the blastState ref so the delayed correct-answer timer (in
  // answer) always advances with the freshest level/pool/poolPos, and never
  // double-advances out of 'playing'. Restored (was dropped in K27 leaving
  // dangling references).
  const advance = () => {
    clearBlastFlash()
    const { pool, poolPos, level, phase } = blastState.current
    if (phase !== 'playing') return
    const pos = poolPos + 1
    setPoolPos(pos)
    setFeedback(null)
    launch(pool, pos, level)
  }

  // K27: register advance handler for Enter key in feedback phase (wrong answers).
  useEffect(() => {
    advanceRegistry.handler = (feedback === 'wrong') ? advance : null
    return () => { if (advanceRegistry.handler === advance) advanceRegistry.handler = null }
  }, [feedback, advance])

  // K23 (2): digits 1..N click the visible Blast blocks (DOM order).
  useEffect(() => {
    if (phase !== 'playing') { answerRegistry.handlers = []; return }
    answerRegistry.handlers = blocks.map((b) => () => answer(b))
    return () => { answerRegistry.handlers = [] }
  }, [phase, blocks])

  if (phase === 'start') {
    return (
      <div className="quiz blast">
        <div className="quiz-card blast-intro">
          <span className="face-label">Blast · Аркада</span>
          <h2 className="quiz-word">Взрывайте правильные переводы</h2>
          <p className="match-desc">
            Слово в центре, вокруг — летающие блоки с переводами. Верный ответ —
            <strong>+1 очко</strong>, ошибка — <strong>−1 очко и −1 жизнь</strong>.
            Пройдите {BLAST_LEVELS} уровней, пока не кончились сердца.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={start}>Старт</button>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="quiz quiz-result blast-result">
        <h2>{result === 'win' ? 'Победа! 🏆' : 'Игра окончена'}</h2>
        <p className="quiz-result-score">Очки: {score}</p>
        <p className="quiz-result-pct">Уровень {level}</p>
        <button type="button" className="btn btn-primary" onClick={start}>Играть снова</button>
      </div>
    )
  }

  return (
    <div className="quiz blast">
      {flash && <div className="blast-flash-green" aria-hidden="true" />}
      <div className="blast-hud">
        <span className="blast-score">Очки: <strong>{score}</strong></span>
        <span className="blast-lives">{'❤️'.repeat(Math.max(0, lives))}</span>
        <span className="blast-level">Уровень {level}</span>
      </div>
      <div className="quiz-card blast-q">
        <span className="face-label">Blast · Найдите перевод</span>
        <h2 className="quiz-word">{qidx >= 0 ? cards[qidx].word : ''}</h2>
      </div>
      <div className="blast-board">
        {blocks.map((b, i) => {
          let cls = 'blast-block' + (feedback && b.correct ? ' correct' : '')
          return (
            <button
              key={i}
              type="button"
              className={cls}
              data-cardidx={b.idx}
              data-correct={String(b.correct)}
              style={{ animationDuration: Math.max(2.6 - (level - 1) * 0.4, 1.2) + 's', animationDelay: (i % 5) * 0.2 + 's' }}
              onClick={() => answer(b)}
            >
              <span className="choice-digit blast-digit">{i + 1}</span>
              {b.label}
            </button>
          )
        })}
      </div>
      {feedback && (
        <div className={'study-feedback ' + feedback}>
          {feedback === 'correct' ? 'Верно! +1 очко' : 'Мимо! −1 очко, −1 жизнь'}
        </div>
      )}
      {/* K26: wrong answers need a manual Далее; correct answers auto-advance. */}
      {feedback === 'wrong' && (
        <button type="button" className="btn btn-primary quiz-next" onClick={advance}>Далее</button>
      )}
    </div>
  )
}

// K4 priority mode helpers ------------------------------------------------------
// Persisted mode across sessions: 'on' (sort by view count, default) / 'off'.
const PRIORITY_KEY = 'fc_priority_mode'

function readPriority() {
  return localStorage.getItem(PRIORITY_KEY) !== 'off' // default to 'on'
}

// K10 settings persisted in localStorage.
const AUTOSPEAK_KEY = 'fc_autospeak'
const PLAY_INTERVAL_KEY = 'fc_play_interval'

function readAutospeak() {
  return localStorage.getItem(AUTOSPEAK_KEY) === '1'
}
function persistAutospeak(v) {
  localStorage.setItem(AUTOSPEAK_KEY, v ? '1' : '0')
}
function readPlayInterval() {
  const v = Number(localStorage.getItem(PLAY_INTERVAL_KEY))
  return [3, 5, 10].includes(v) ? v : 5
}
function persistPlayInterval(v) {
  localStorage.setItem(PLAY_INTERVAL_KEY, String(v))
}

// K15 keyboard legend: a compact, collapsible shortcut reference that is
// reachable from EVERY study mode (not only cards). Shared Russian labels are
// the single source of truth for the shortcut text.
function KeyboardLegend() {
  const [open, setOpen] = useState(false)
  const rows = [
    ['← / →', 'предыдущая / следующая карточка (Карточки)'],
    ['Пробел', 'перевернуть карточку (Карточки)'],
    ['Enter', 'проверить ответ (Write / Тест)'],
    ['S', 'перемешать'],
    ['P', 'play / пауза (Карточки)'],
    ['F', 'полный экран'],
    ['Esc', 'закрыть полный экран'],
  ]
  return (
    <div className="kb-legend" data-testid="kb-legend">
      <button
        type="button"
        className="kb-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="kb-toggle"
        title="Управление клавиатурой"
      >
        <span className="kb-icon">?</span>
        <span className="kb-title">Управление клавиатурой</span>
        <span className="kb-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <table className="kb-table" data-testid="kb-table">
          <tbody>
            {rows.map(([key, desc]) => (
              <tr key={key}>
                <td className="kb-key">{key}</td>
                <td className="kb-desc">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function SetPage() {
  const { id } = useParams()
  const { isLoggedIn } = useAuth()
  // K22: `set` is re-readable via setSet (state) so the "+ Добавить карточки"
  // flow can refresh the page set after cards are appended to the server.
  const [set, setSet] = useState(() => getSet(id))
  const [mode, setMode] = useState('cards')

  // K30: on mount, if the set is not already in the local cache (e.g. the
  // page was reached via a deep/shared link with an empty or stale local
  // store), fetch it straight from the server so the set still renders.
  useEffect(() => {
    if (set) return
    let active = true
    apiGetSet(id)
      .then((s) => { if (active && s && s.id) setSet(s) })
      .catch(() => { /* keep the not-found state; server unreachable */ })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  // K22: inline "add cards" form state.
  const [showAdd, setShowAdd] = useState(false)
  const [addText, setAddText] = useState('')
  const [addMsg, setAddMsg] = useState('')
  const [addError, setAddError] = useState('')
  // K19: guests may only VIEW cards. The other study modes (Learn, Write,
  // Тест, Spell, Match, Blast) plus all progress are login-gated.
  const LOGIN_MODES = ['learn', 'write', 'test', 'spell', 'match', 'blast']
  const [gateOpen, setGateOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState(null)
  const selectMode = (m) => {
    if (m !== 'cards' && !isLoggedIn) {
      // Remember the mode the guest wanted, so a successful login from the
      // gate resumes straight into it.
      setPendingMode(m)
      setGateOpen(true)
    } else {
      setMode(m)
    }
  }
  // When a guest logs in via the gate, jump into the mode they were after.
  useEffect(() => {
    if (isLoggedIn && pendingMode) {
      setMode(pendingMode)
      setPendingMode(null)
    }
  }, [isLoggedIn])
  const [flipped, setFlipped] = useState(false)
  const [priority, setPriorityMode] = useState(readPriority)
  // K11: "Поделиться" message (link + JSON copied to clipboard).
  const [shareMsg, setShareMsg] = useState('')

  // K10: auto-speak + autoplay + filters + fullscreen states.
  const [autospeak, setAutospeak] = useState(readAutospeak)
  const [playInterval, setPlayInterval] = useState(readPlayInterval)
  const [playing, setPlaying] = useState(false)
  const [starredOnly, setStarredOnly] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [starVer, setStarVer] = useState(0)
  // K23 (5): collapsible top-right settings menu (non-vertical shift of game area).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // K27: direction state owned by SetPage so the settings panel can bind to it.
  const [studyDirection, setStudyDirection] = useState('en-ru')
  // K27: study registry for cross-mode shuffle.

  // K23 (1): when entering fullscreen in ANY mode we drive the presentation with
  // CSS classes on `document.body` + the page root (see styles.css .fs-active),
  // which hides the global app header too, so the game area truly fills the
  // viewport. This is a body-level side effect of the same `fullscreen` state.
  useEffect(() => {
    const b = document.body
    if (fullscreen) b.classList.add('fs-body')
    else b.classList.remove('fs-body')
    return () => b.classList.remove('fs-body')
  }, [fullscreen])
  // K23 (6): entering fullscreen on mobile collapses the settings menu so only
  // the game remains (the sidebar/chrome are hidden by CSS anyway).
  useEffect(() => {
    if (fullscreen) setSettingsOpen(false)
  }, [fullscreen])

  // Display order of card indices for the current pass of cards mode.
  // Computed once on entry / restart, then fixed for the whole pass.

  const [order, setOrder] = useState(() => {
    if (!set) return []
    const base = set.cards.map((_, i) => i)
    // K9: cards due today come first, then adaptive priority order.
    return [...base].sort((a, b) => {
      const da = isDueOn(id, a, todayStr()) ? 0 : 1
      const db = isDueOn(id, b, todayStr()) ? 0 : 1
      if (da !== db) return da - db
      if (readPriority()) {
        const va = getViews(id, a)
        const vb = getViews(id, b)
        if (va !== vb) return va - vb
      }
      return a - b
    })
  })
  const [pos, setPos] = useState(0)

  const count = set ? set.cards.length : 0
  const cardsDue = set ? dueCount(id, set.cards) : 0

  // K9 review-first display order used in cards mode (due cards first, then
  // per the K4 priority setting which sorts by fewest views first).
  const computeOrder = (usePriority) => {
    if (!set) return []
    const base = set.cards.map((_, i) => i)
    return [...base].sort((a, b) => {
      const da = isDueOn(id, a, todayStr()) ? 0 : 1
      const db = isDueOn(id, b, todayStr()) ? 0 : 1
      if (da !== db) return da - db
      if (usePriority) {
        const va = getViews(id, a)
        const vb = getViews(id, b)
        if (va !== vb) return va - vb
      }
      return a - b
    })
  }

  // Apply the K4-priority sort and an optional starred-only filter to a base order.
  const buildDisplayOrder = (usePriority, onlyStarred) => {
    if (!set) return []
    const ord = computeOrder(usePriority)
    return onlyStarred ? ord.filter((i) => getCardStarred(id, i)) : ord
  }

  // K10: randomize the displayed order for the current cards pass.
  const shuffleNow = () => {
    setOrder(shuffle(buildDisplayOrder(priority, starredOnly)))
    setPos(0)
    setFlipped(false)
  }

  // K10: toggle the starred-only filter (drops unstarred cards from the pass).
  const toggleStarredOnly = () => {
    const next = !starredOnly
    setStarredOnly(next)
    setOrder(buildDisplayOrder(priority, next))
    setPos(0)
    setFlipped(false)
  }

  // K10: mark/unmark the current card as important, persisting to fc_stats_.
  const toggleStar = (i) => {
    toggleCardStarred(id, i)
    setStarVer((v) => v + 1)
    if (starredOnly) {
      // In starred-only mode the card may drop out of the pass.
      setOrder(buildDisplayOrder(priority, true))
      setPos(0)
      setFlipped(false)
    }
  }

  const isStarred = (i) => getCardStarred(id, i)

  // When switching INTO cards mode (e.g. from test), recompute a fresh pass.
  // Guard with the previous mode so this does NOT fire on the initial mount
  // (which would re-sort after the first view was already counted, changing the
  // order mid-pass). The pass order is otherwise fixed for its whole duration.
  const prevMode = useRef(mode)
  useEffect(() => {
    if (mode === 'cards' && prevMode.current !== 'cards') {
      setOrder(buildDisplayOrder(priority, starredOnly))
      setPos(0)
      setFlipped(false)
    }
    prevMode.current = mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // The real card index currently displayed = order[pos] (display position).
  const currentIndex = set && order.length ? order[pos] : -1
  const current = set && currentIndex >= 0 ? set.cards[currentIndex] || null : null

  // K10: auto-speak the shown word when a card is displayed (cards mode only).
  useEffect(() => {
    if (mode !== 'cards' || !autospeak || !current || fullscreen) return
    speakEnglish(current.word)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autospeak, currentIndex, fullscreen])

  // K10: autoplay — advance the deck every playInterval seconds until the end.
  useEffect(() => {
    if (!playing || mode !== 'cards' || count === 0) return
    const t = setInterval(() => {
      setPos((p) => {
        if (p >= count - 1) {
          setPlaying(false)
          return 0
        }
        return p + 1
      })
      setFlipped(false)
    }, playInterval * 1000)
    return () => clearInterval(t)
  }, [playing, mode, count, playInterval])

  // Reused by restart / toggle with the same compute logic (respects the filter).
  const applyOrder = (usePriority) => {
    setOrder(buildDisplayOrder(usePriority, starredOnly))
    setPos(0)
    setFlipped(false)
  }

  // K22: reload the page set from the local cache (already refreshed by
  // addCardsShared) and jump back to the cards view so newly added cards show
  // at the end and the progress overview recomputes over the grown cards array.
  const refreshSet = (newSet) => {
    setSet(newSet)
    setMode('cards')
    const base = newSet.cards.map((_, i) => i)
    setOrder([...base].sort((a, b) => {
      const da = isDueOn(id, a, todayStr()) ? 0 : 1
      const db = isDueOn(id, b, todayStr()) ? 0 : 1
      if (da !== db) return da - db
      if (priority) {
        const va = getViews(id, a)
        const vb = getViews(id, b)
        if (va !== vb) return va - vb
      }
      return a - b
    }))
    setPos(0)
    setFlipped(false)
  }

  // K22: submit the inline add-cards form. Parse -> POST to the server (with
  // cache refresh) -> init per-user progress for the newly added indices ->
  // reload the page view. A thrown 401/403/404 surfaces as the error message.
  const handleAddCards = async () => {
    setAddError('')
    setAddMsg('')
    if (!addText.trim()) {
      setAddError('Вставьте JSON с карточками.')
      return
    }
    try {
      const oldCount = set ? set.cards.length : 0
      const parsed = parseCardsOnly(addText)
      const res = await addCardsShared(id, parsed.cards)
      initNewCardProgress(id, oldCount, res.added)
      refreshSet(res.set)
      setAddMsg(`Добавлено ${res.added} карточек в набор.`)
      setAddText('')
    } catch (err) {
      setAddError(addCardsErrorMsg(err))
    }
  }

  // View counter: increments for the currently displayed ORIGINAL card index.
  // Only counts a real view when the deck is actually shown (cards mode with at
  // least one card due today). Also marks the day as studied.
  useEffect(() => {
    if (currentIndex < 0 || !current) return
    if (mode !== 'cards' || cardsDue === 0) return
    recordStudyDay()
    recordCardView(id, currentIndex)
  }, [id, currentIndex, current, mode, cardsDue])

  // "Заново": reset to the start of the pass and recompute the order once.
  const restart = () => applyOrder(priority)

  // Toggle priority mode; persists to localStorage and reorders immediately.
  const togglePriority = () => {
    const next = !priority
    setPriorityMode(next)
    localStorage.setItem(PRIORITY_KEY, next ? 'on' : 'off')
    applyOrder(next)
  }

  const goPrev = () => {
    setPos((p) => Math.max(p - 1, 0))
    setFlipped(false)
  }
  const goNext = () => {
    setPos((p) => Math.min(p + 1, count - 1))
    setFlipped(false)
  }

  // K15 GLOBAL keyboard shortcuts (work in EVERY study mode on this page).
  // Refs hold the latest state + handlers so a single stable keydown listener
  // never goes stale, avoiding re-registration churn on every state change.
  const hotkeys = useRef({
    mode, count, total: order.length, fullscreen,
    goNext, goPrev, shuffleNow, setFlipped, setPlaying, setFullscreen,
  })
  hotkeys.current = {
    mode, count, total: order.length, fullscreen,
    goNext, goPrev, shuffleNow, setFlipped, setPlaying, setFullscreen,
  }

  useEffect(() => {
    const onKey = (e) => {
      const h = hotkeys.current
      const t = e.target
      const inField =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

      // Escape always closes fullscreen — even while typing in an input.
      if (e.key === 'Escape') {
        if (h.fullscreen) {
          e.preventDefault()
          h.setFullscreen(false)
        }
        return
      }

      // Never let global shortcuts fire while the user is typing in a text
      // field (letter keys s/p/f, arrows, space, enter are all ignored here).
      // The Write / Spell / Test typed inputs handle Enter themselves locally.
      if (inField) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const k = e.key

      // K27: Enter for Далее in all study modes — fires outside text fields
      // when a study mode has registered an advance handler (feedback phase).
      if (e.key === 'Enter' && !inField && advanceRegistry.handler) {
        e.preventDefault()
        advanceRegistry.handler()
        return
      }

      // 'F' toggles fullscreen in every mode.
      if (k === 'f' || k === 'F' || k === 'а') {
        e.preventDefault()
        h.setFullscreen((v) => !v)
        return
      }

      // K23 (4): Match mode keyboard pairing. A digit selects a left (term)
      // row, a letter a.. selects a right (trans) row; when a digit AND a letter
      // have both been entered (in either order) the pair is placed — exactly
      // as if the term then the translation were clicked. Delegated to the live
      // Match registry; returns true when it consumed the key.
      if (h.mode === 'match' && matchRegistry.active && matchRegistry.handle) {
        if (matchRegistry.handle(k)) {
          e.preventDefault()
          return
        }
      }

      // K23 (2): digit answer-option hotkeys (1..N) in EVERY mode. The active
      // mode registers its currently visible answer handlers (array order == DOM
      // order), so pressing digit N triggers the exact same action as clicking
      // that answer button. N is unbounded but each key is a single digit (1..9),
      // so Blast blocks beyond the 4th remain reachable by keyboard too. This runs
      // after the in-field guard above, so digits never fire while typing.
      if (/^[1-9]$/.test(k)) {
        const opts = answerRegistry.handlers
        const idx = Number(k) - 1
        if (opts && idx < opts.length && opts[idx]) {
          e.preventDefault()
          opts[idx]()
          answerRegistry.handlers = []
        }
        return
      }

      // Cards-mode actions: prev/next, flip, shuffle, play/pause.
      if (h.mode === 'cards') {
        if (k === 'ArrowRight') {
          e.preventDefault(); h.goNext()
        } else if (k === 'ArrowLeft') {
          e.preventDefault(); h.goPrev()
        } else if (k === ' ') {
          e.preventDefault(); h.setFlipped((f) => !f)
        } else if (k === 's' || k === 'S' || k === 'ы') {
          e.preventDefault(); h.shuffleNow()
        } else if (k === 'p' || k === 'P' || k === 'з') {
          e.preventDefault(); h.setPlaying((v) => !v)
        }
        return
      }

      // Non-cards modes: keep consistent 'S' shuffle and 'P' play/pause
      // available (they operate on the cards pass order).
      if (k === 's' || k === 'S' || k === 'ы') {
        e.preventDefault(); h.shuffleNow()
      } else if (k === 'p' || k === 'P' || k === 'з') {
        e.preventDefault(); h.setPlaying((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // K9: progress overview (X из N per status), mastery bar, reset + report.
  const ProgressOverview = () => {
    const n = count
    const statuses = getStatuses(id)
    let mastered = 0
    let learning = 0
    let notStudied = 0
    for (let i = 0; i < n; i++) {
      const s = statuses[String(i)] || 'not_studied'
      if (s === 'mastered') mastered += 1
      else if (s === 'learning') learning += 1
      else notStudied += 1
    }
    const pct = n ? Math.round((mastered / n) * 100) : 0
    const handleReset = () => {
      if (typeof window !== 'undefined' && !window.confirm('Сбросить весь прогресс по этому набору?')) return
      resetSetProgress(id)
      setPlaying(false)
      setFullscreen(false)
      setMode('cards')
      setOrder(buildDisplayOrder(priority, starredOnly))
      setPos(0)
      setFlipped(false)
    }
    return (
      <div className="k9-progress" data-testid="k9-progress">
        <div className="k9-progress-stats">
          <span className="k9-stat not-studied">Не изучено: {notStudied} из {n}</span>
          <span className="k9-stat learning">В процессе: {learning} из {n}</span>
          <span className="k9-stat mastered">Освоено: {mastered} из {n}</span>
        </div>
        <div className="k9-mastery-wrap">
          <div className="k9-mastery-bar">
            <div className="k9-mastery-fill" style={{ width: pct + '%' }} />
          </div>
          <span className="k9-mastery-label">Освоено {mastered} из {n} · {pct}%</span>
        </div>
        <div className="k9-progress-actions">
          <button type="button" className="btn btn-outline" onClick={downloadProgressReport}>Скачать отчёт</button>
          <button type="button" className="btn btn-danger" onClick={handleReset}>Сбросить прогресс</button>
        </div>
      </div>
    )
  }

  // K11: copy the share link AND the set JSON to the clipboard.
  const handleShare = async () => {
    if (!set) return
    const link = `https://${window.location.host}/#/set/${set.id}`
    const payload = JSON.stringify(set)
    try {
      await navigator.clipboard.writeText(link + '\n' + payload)
      setShareMsg('Ссылка и JSON набора скопированы в буфер обмена.')
    } catch (e) {
      setShareMsg('Не удалось скопировать (нужен доступ к буферу обмена).')
    }
  }

  if (!set) {
    return (
      <div className="page">
        <div className="empty">
          <p>Набор не найден.</p>
          <Link className="btn btn-primary" to="/">К моим наборам</Link>
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        'page set-layout set-page' +
        (fullscreen ? ' fs-active' : '') +
        (settingsOpen ? ' settings-open' : '')
      }
    >
      <aside className="set-sidebar">
      <div className="set-head">
        <Link to="/" className="back-link">← Мои наборы</Link>
        <h1>{set.topic || 'Без названия'}</h1>
        <span className="set-count big">{set.cards.length} карточек</span>
        <button type="button" className="btn btn-outline k11-share" onClick={handleShare} data-testid="share-btn">
          🔗 Поделиться
        </button>
        {shareMsg && <div className="k11-share-msg" data-testid="share-msg">{shareMsg}</div>}
        <button
          type="button"
          className="btn btn-outline k22-add-cards-btn"
          onClick={() => { setAddError(''); setAddMsg(''); setShowAdd((v) => !v) }}
          data-testid="add-cards-btn"
        >
          + Добавить карточки
        </button>
        {showAdd && (
          <div className="k22-add-form" data-testid="add-cards-form">
            <p className="k22-add-hint">Вставьте JSON с карточками:</p>
            <textarea
              className="json-input k22-add-input"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={6}
              placeholder={'{"cards": [{"word": "слово", "translation": "перевод"}]}'}
              data-testid="add-cards-text"
            />
            <div className="k22-add-actions">
              <button type="button" className="btn btn-primary" onClick={handleAddCards} data-testid="add-cards-submit">
                Добавить
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)}>
                Отмена
              </button>
            </div>
            {addError && <div className="error" data-testid="add-cards-error">{addError}</div>}
            {addMsg && <div className="success" data-testid="add-cards-msg">{addMsg}</div>}
          </div>
        )}
      </div>

      {set.lesson_meta && (set.lesson_meta.song || (set.lesson_meta.grammar && set.lesson_meta.grammar.length > 0)) && (
        <div className="lesson-meta">
          {set.lesson_meta.song && (
            <p><strong>Песня:</strong> {set.lesson_meta.song}</p>
          )}
          {set.lesson_meta.grammar && set.lesson_meta.grammar.length > 0 && (
            <div className="grammar">
              <strong>Грамматика:</strong>
              <ul>
                {set.lesson_meta.grammar.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <ProgressOverview />
      </aside>

      <div className="set-main">
      <div className="set-main-head">
      <div className="mode-switcher" role="tablist" aria-label="Режим просмотра">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'cards'}
          className={'mode-btn' + (mode === 'cards' ? ' active' : '')}
          onClick={() => setMode('cards')}
        >
          Карточки
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'learn'}
          className={'mode-btn' + (mode === 'learn' ? ' active' : '')}
          title="Адаптивное обучение"
          onClick={() => selectMode('learn')}
        >
          Learn
          <span className="mode-k6">K6</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'write'}
          className={'mode-btn' + (mode === 'write' ? ' active' : '')}
          title="Активное припоминание"
          onClick={() => selectMode('write')}
        >
          Write
          <span className="mode-k6">K6</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'test'}
          className={'mode-btn' + (mode === 'test' ? ' active' : '')}
          title="Режим теста"
          onClick={() => selectMode('test')}
        >
          Тест
          <span className="mode-k3">K3</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'spell'}
          className={'mode-btn' + (mode === 'spell' ? ' active' : '')}
          title="Написание на слух"
          onClick={() => selectMode('spell')}
        >
          Spell
          <span className="mode-k7">K7</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'match'}
          className={'mode-btn' + (mode === 'match' ? ' active' : '')}
          title="Сопоставление на время"
          onClick={() => selectMode('match')}
        >
          Match
          <span className="mode-k8">K8</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'blast'}
          className={'mode-btn' + (mode === 'blast' ? ' active' : '')}
          title="Аркадная игра"
          onClick={() => selectMode('blast')}
        >
          Blast
          <span className="mode-k8">K8</span>
        </button>
      </div>

      {/* K23 (5): top-right collapsible settings menu (visible in every mode). */}
        <button
          type="button"
          className="settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
          data-testid="settings-toggle"
          title="Настройки"
        >
          <span aria-hidden="true">⚙</span>
          <span className="settings-toggle-label">Настройки</span>
          <span className="settings-chevron">{settingsOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      {settingsOpen && (
        <div className="settings-panel" data-testid="settings-panel">
          <div className="settings-panel-title">Настройки</div>
          <button
            type="button"
            className="btn btn-outline settings-fs-btn"
            onClick={() => setFullscreen((v) => !v)}
            data-testid="settings-fullscreen"
          >
            ⛶ Полный экран
          </button>
          <div className="settings-panel-group" data-testid="settings-cards-controls">
            {/* K27: direction toggle visible in learn/write modes */}
            {(mode === 'learn' || mode === 'write') && (
              <div className="settings-panel-row btns">
                <div className="quiz-direction" role="tablist" aria-label="Направление">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studyDirection === 'en-ru'}
                    className={'quiz-dir-btn' + (studyDirection === 'en-ru' ? ' active' : '')}
                    onClick={() => setStudyDirection('en-ru')}
                    data-testid="settings-dir-en-ru"
                  >
                    en-ru
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studyDirection === 'ru-en'}
                    className={'quiz-dir-btn' + (studyDirection === 'ru-en' ? ' active' : '')}
                    onClick={() => setStudyDirection('ru-en')}
                    data-testid="settings-dir-ru-en"
                  >
                    ru-en
                  </button>
                </div>
              </div>
            )}
            <label className="settings-panel-row">
              <input type="checkbox" checked={priority} onChange={togglePriority} data-testid="settings-priority" />
              <span>Приоритет повторения</span>
            </label>
            <label className="settings-panel-row">
              <input type="checkbox" checked={starredOnly} onChange={toggleStarredOnly} data-testid="settings-starred" />
              <span>Только помеченные</span>
            </label>
            <label className="settings-panel-row">
              <input type="checkbox" checked={autospeak} onChange={() => { const v = !autospeak; setAutospeak(v); persistAutospeak(v) }} />
              <span>Автоозвучка</span>
            </label>
            <div className="settings-panel-row btns">
              <button type="button" className="btn btn-outline" onClick={() => setPlaying((v) => !v)} data-testid="settings-play">
                {playing ? '⏸ Пауза' : '▶ Play'}
              </button>
              <select
                className="play-interval"
                value={playInterval}
                onChange={(e) => { const v = Number(e.target.value); setPlayInterval(v); persistPlayInterval(v) }}
                data-testid="settings-interval"
              >
                <option value={3}>3 с</option>
                <option value={5}>5 с</option>
                <option value={10}>10 с</option>
              </select>
            </div>
            <div className="settings-panel-row btns">
              <button type="button" className="btn btn-outline" onClick={() => { if (studyRegistry.shuffleNow) studyRegistry.shuffleNow(); else shuffleNow() }} data-testid="settings-shuffle">🔀 Перемешать</button>
              <button type="button" className="btn btn-outline" onClick={restart}>Заново</button>
            </div>
          </div>
          {mode !== 'cards' && (
            <p className="settings-panel-note">
              Настройки этого режима расположены внутри самого режима. Здесь доступны общие
              элементы: полный экран, перемешать и порядок карточек.
            </p>
          )}
        </div>
      )}

      <div className="mode-stage" data-testid={fullscreen ? 'fs-overlay' : undefined}>
      {count === 0 ? (
        <div className="test-placeholder">
          <p>В этом наборе нет карточек.</p>
        </div>
      ) : mode === 'test' ? (
        <ExtendedTest set={set} id={id} />
      ) : mode === 'spell' ? (
        <Spell set={set} id={id} studyDirection={studyDirection} setStudyDirection={setStudyDirection} />
      ) : mode === 'match' ? (
        <Match set={set} id={id} />
      ) : mode === 'blast' ? (
        <Blast set={set} id={id} />
      ) : mode === 'learn' ? (
        <Learn set={set} id={id} studyDirection={studyDirection} setStudyDirection={setStudyDirection} />
      ) : mode === 'write' ? (
        <Write set={set} id={id} studyDirection={studyDirection} setStudyDirection={setStudyDirection} />
      ) : cardsDue === 0 ? (
        <NoReviews onRestart={restart} />
      ) : order.length === 0 ? (
        <div className="test-placeholder" data-testid="no-starred">
          <p>Нет помеченных карточек.</p>
          <button type="button" className="btn btn-primary" onClick={toggleStarredOnly}>
            Показать все карточки
          </button>
        </div>
      ) : (
        <div className="deck">
          <div className="flashcard-wrap">
            {currentIndex >= 0 && isDueOn(id, currentIndex, todayStr()) && (
              <span className="review-badge">к повторению</span>
            )}
            {/* K17 (A5): the 🔊/★/⛶ action buttons sit on the card, centered
                between the left review marker and the right views badge. */}
            <div className="card-actions">
              <button
                type="button"
                className="btn-icon"
                title="Озвучить"
                onClick={() => speakEnglish(current.word)}
                data-testid="speak-btn"
              >
                🔊
              </button>
              <button
                type="button"
                className="btn-icon"
                title={isStarred(currentIndex) ? 'Убрать метку' : 'Пометить важным'}
                onClick={() => toggleStar(currentIndex)}
                data-testid="star-btn"
              >
                {isStarred(currentIndex) ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="btn-icon"
                title="Полный экран"
                onClick={() => setFullscreen(true)}
                data-testid="fullscreen-btn"
              >
                ⛶
              </button>
            </div>
            <span className="view-badge">Показов: {getViews(id, currentIndex)}</span>
            <div
              className="flashcard-scene"
              role="button"
              tabIndex={0}
              onClick={() => setFlipped((f) => !f)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFlipped((f) => !f) }}
            >
              <div className={'flashcard' + (flipped ? ' flipped' : '')}>
                <CardFront card={current} />
                <CardBack card={current} />
              </div>
            </div>
          </div>

          <div className="deck-controls">
            <button className="btn btn-outline" onClick={goPrev} disabled={pos === 0}>← Назад</button>
            <span className="deck-progress">Карточка {pos + 1} из {order.length}</span>
            <button className="btn btn-outline" onClick={goNext} disabled={pos === order.length - 1}>Вперёд →</button>
          </div>

          <div className="keys-hints" data-testid="keys-hints">
            ← →: листать · Пробел: переворот · S: перемешать · P: play/pause · F: полный экран · Esc: закрыть
          </div>
        </div>
      )}
      </div>{/* /mode-stage */}

      {/* K17: the collapsible keyboard legend lives at the very BOTTOM of the
          main area, below the tasks/stage, reachable in every mode. */}
      <KeyboardLegend />

      </div>{/* /set-main */}

      {/* K23/K26: ONE unified floating fullscreen exit button, shown in EVERY
          mode when fullscreen is active (Cards included). */}
      {fullscreen && (
        <button
          type="button"
          className="fs-exit-btn"
          onClick={() => setFullscreen(false)}
          data-testid="fs-exit"
          title="Выйти из полного экрана (Esc)"
        >
          ✕ Выйти
        </button>
      )}

      {/* K19: login gate for guests trying to start a training mode.
          Guests may only VIEW cards; every other mode is blocked behind \"Войти\". */}
      {gateOpen && (
        <div className="modal-overlay" onClick={() => setGateOpen(false)} data-testid="login-gate">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Войдите, чтобы тренироваться</h2>
            <p className="modal-note">
              Без входа доступен только просмотр карточек. Режимы тренировки и весь прогресс
              привязаны к вашему аккаунту.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="gate-login-btn"
                onClick={() => { setGateOpen(false); setLoginOpen(true) }}
              >
                Войти / Регистрация
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setGateOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
