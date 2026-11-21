// Progress indicator for the student's path into an exam:
// Overview -> Instructions -> System check -> Exam. Purely presentational;
// it does not navigate, so it cannot let a student skip a required step.
const STEPS = ['Overview', 'Instructions', 'System check', 'Exam']

export default function ExamStepper({ current }) {
  return (
    <nav className="exam-stepper" aria-label={`Step ${current} of ${STEPS.length}`}>
      <ol className="exam-stepper__list">
        {STEPS.map((label, index) => {
          const step = index + 1
          const state = step < current ? 'done' : step === current ? 'current' : 'upcoming'
          return (
            <li
              key={label}
              className={`exam-stepper__step exam-stepper__step--${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="exam-stepper__dot" aria-hidden="true">
                {state === 'done' ? '✓' : step}
              </span>
              <span className="exam-stepper__label">
                {label}
                {state === 'done' && <span className="visually-hidden"> (completed)</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
