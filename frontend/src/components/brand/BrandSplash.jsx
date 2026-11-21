import BrandLogo from './BrandLogo'

// Full-screen branded loader for app-level waits (e.g. restoring the
// session on first load) -- the official mark with a soft pulse instead of
// a bare spinner. Honours prefers-reduced-motion via CSS.
export default function BrandSplash({ message = 'Loading...' }) {
  return (
    <div className="brand-splash" role="status" aria-live="polite">
      <div className="brand-splash__mark">
        <BrandLogo variant="mark" height={56} decorative />
      </div>
      <p className="brand-splash__message">{message}</p>
    </div>
  )
}
