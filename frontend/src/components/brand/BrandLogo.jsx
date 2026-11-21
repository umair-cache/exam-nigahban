import { MARK_PATH, WORD_EXAM_PATHS, WORD_NIGAHBAN_PATHS } from './logoPaths'

// The official Exam Nigahban logo, drawn inline from the original artwork
// so it stays crisp at every size and can adapt to its background.
//
//   variant  'full' -- the "E" mark with the stacked Exam / Nigahban wordmark
//            'mark' -- the "E" mark on its own (tight spaces, icons, splash)
//   tone     'default' -- brand-blue mark, dark wordmark (light surfaces)
//            'light'   -- brand-blue mark, white wordmark (dark surfaces)
//            'mono'    -- everything in currentColor (single-colour uses)
//   height   rendered height in px; width follows the official proportions.
//
// The mark's colour is always the official #4656A8 (also --app-primary)
// except in 'mono'. The artwork is exposed to assistive technology as one
// image named "Exam Nigahban" unless `decorative` is set.
const FULL_VIEWBOX = { width: 178.598, height: 61.456 }
const MARK_VIEWBOX = { x: 0.3, width: 50.887, height: 61.456 }
const BRAND_BLUE = '#4656A8'

const WORDMARK_COLORS = {
  default: 'var(--app-text-primary, #0F172A)',
  light: '#FFFFFF',
  mono: 'currentColor',
}

export default function BrandLogo({
  variant = 'full',
  tone = 'default',
  height = 40,
  decorative = false,
  className = '',
  title = 'Exam Nigahban',
  ...rest
}) {
  const isMark = variant === 'mark'
  const box = isMark ? MARK_VIEWBOX : FULL_VIEWBOX
  const viewBox = isMark
    ? `${MARK_VIEWBOX.x} 0 ${box.width} ${box.height}`
    : `0 0 ${box.width} ${box.height}`
  const width = Math.round((height * box.width) / box.height * 10) / 10
  const markFill = tone === 'mono' ? 'currentColor' : BRAND_BLUE
  const wordFill = WORDMARK_COLORS[tone] ?? WORDMARK_COLORS.default

  const a11y = decorative
    ? { 'aria-hidden': true, focusable: 'false' }
    : { role: 'img', 'aria-label': title }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={height}
      className={`brand-logo brand-logo--${variant} ${className}`.trim()}
      style={{ fillRule: 'evenodd', clipRule: 'evenodd' }}
      {...a11y}
      {...rest}
    >
      {!decorative && <title>{title}</title>}
      <path className="brand-logo__mark" d={MARK_PATH} fill={markFill} />
      {!isMark && (
        <g className="brand-logo__wordmark" fill={wordFill} fillRule="nonzero">
          {WORD_EXAM_PATHS.map((d, i) => (
            <path key={`e${i}`} d={d} />
          ))}
          {WORD_NIGAHBAN_PATHS.map((d, i) => (
            <path key={`n${i}`} d={d} />
          ))}
        </g>
      )}
    </svg>
  )
}
