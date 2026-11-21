import { Link } from 'react-router-dom'
import BrandLogo from '../components/brand/BrandLogo'

export default function NotFoundPage() {
  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100">
      <div className="text-center">
        <BrandLogo height={44} className="mb-4" />
        <h1 className="h4 mb-2">Page Not Found</h1>
        <p className="text-muted mb-4">The page you're looking for doesn't exist.</p>
        <Link to="/login" className="btn btn-primary">
          Back to Login
        </Link>
      </div>
    </div>
  )
}
