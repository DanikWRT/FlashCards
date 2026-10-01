import { matchAnswer, answerVariants } from './src/normalize.js'

let pass = 0
let fail = 0
function assert(name, actual, expected) {
  if (actual === expected) {
    pass++
    console.log('PASS  ' + name)
  } else {
    fail++
    console.log('FAIL  ' + name + '  => got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected))
  }
}

// Requirement 3 examples that MUST pass.
assert('Foot/Feet: foot correct', matchAnswer('foot', 'Foot / Feet'), true)
assert('Foot/Feet: feet correct', matchAnswer('feet', 'Foot / Feet'), true)
assert('Foot/Feet: Foot correct (case)', matchAnswer('Foot', 'Foot / Feet'), true)
assert('Foot/Feet: ankle wrong', matchAnswer('ankle', 'Foot / Feet'), false)

assert('Kneel: kneel correct', matchAnswer('kneel', 'Kneel'), true)
assert('Kneel: knee wrong', matchAnswer('knee', 'Kneel'), false)

assert('губы: губы correct', matchAnswer('губы', 'губы (ед. ч. lip)'), true)
assert('губы: губа wrong', matchAnswer('губа', 'губы (ед. ч. lip)'), false)

assert('бедро/таз/хип: бедро correct', matchAnswer('бедро', 'бедро (таз), хип'), true)
assert('бедро/таз/хип: хип correct', matchAnswer('хип', 'бедро (таз), хип'), true)
assert('бедро/таз/хип: таз correct', matchAnswer('таз', 'бедро (таз), хип'), true)
assert('бедро/таз/хип: голень wrong', matchAnswer('голень', 'бедро (таз), хип'), false)

assert('палец ноги/пальцы ног: палец ноги correct', matchAnswer('палец ноги', 'палец ноги / пальцы ног'), true)
assert('палец ноги/пальцы ног: пальцы ног correct', matchAnswer('пальцы ног', 'палец ноги / пальцы ног'), true)
assert('палец ноги/пальцы ног: палец wrong (partial)', matchAnswer('палец', 'палец ноги / пальцы ног'), false)

// Requirement 4: normal single terms still work.
assert('Body: body correct', matchAnswer('body', 'Body'), true)
assert('Body: BO DY wrong', matchAnswer('BO DY', 'Body'), false)

// Don't know / skip button sends empty string -> must stay WRONG.
assert('empty string wrong', matchAnswer('', 'Foot / Feet'), false)
assert('whitespace string wrong', matchAnswer('   ', 'Foot / Feet'), false)

// answerVariants sanity checks.
assert('variants Foot/Feet', JSON.stringify(answerVariants('Foot / Feet')), JSON.stringify(['foot', 'feet']))
assert('variants Kneel', JSON.stringify(answerVariants('Kneel')), JSON.stringify(['kneel']))
const bv = answerVariants('бедро (таз), хип')
assert('variants metric contains таз/бедро/хип', bv.includes('таз') && bv.includes('бедро') && bv.includes('хип'), true)
assert('variants губы keeps paren explanation as non-matching entry', answerVariants('губы (ед. ч. lip)').includes('ед. ч. lip'), true)

console.log('')
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) { process.exit(1) }
