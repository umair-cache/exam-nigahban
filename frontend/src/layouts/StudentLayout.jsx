import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LogoutIcon } from '../components/admin/icons'
import BrandLogo from '../components/brand/BrandLogo'

export default function StudentLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Focused exam mode: while a paper is open the header shows only the
  // brand and an "Exam in progress" label -- no navigation and no Logout,
  // so a candidate cannot leave the exam with one stray click. Everything
  // else about the exam page is unchanged.
  const inExam = /^\/student\/exams\/[^/]+\/take\/?$/.test(pathname)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <nav className="navbar navbar-expand navbar-dark bg-dark">
        <div className="container">
          {inExam ? (
            <span className="navbar-brand brand-navbar-link py-1 mb-0">
              <BrandLogo tone="light" height={34} />
            </span>
          ) : (
            <Link to="/student/exams" className="navbar-brand brand-navbar-link py-1 mb-0">
              <BrandLogo tone="light" height={34} />
            </Link>
          )}
          {!inExam && (
            <ul className="navbar-nav me-auto ms-2">
              <li className="nav-item">
                <NavLink to="/student/exams" className="nav-link px-3">
                  My Exams
                </NavLink>
              </li>
            </ul>
          )}
          {/* Same structure/spacing/sizing as AdminLayout's header account
              area (username, role badge, Logout as three flex siblings on
              one gap-2 row) -- but keeping the light-on-dark button/text
              variants (btn-outline-light / text-light) rather than
              AdminLayout's btn-outline-secondary, since this navbar stays
              dark (bg-dark, unchanged) while the admin header is a light
              surface; reusing the admin header's dark-on-light classes
              here would be nearly invisible against this background. */}
          {inExam && (
            <span className="exam-mode-badge ms-auto">
              <span className="exam-mode-badge__dot" aria-hidden="true" />
              Exam in progress
            </span>
          )}
          {user && !inExam && (
            <div className="student-header__account d-flex align-items-center gap-2 ms-auto">
              <span className="student-header__username text-light text-truncate small">
                {user.username}
              </span>
              <span className="badge text-bg-secondary">Student</span>
              <button
                type="button"
                className="btn btn-outline-light btn-sm d-flex align-items-center gap-1"
                onClick={handleLogout}
              >
                <LogoutIcon width={14} height={14} />
                Logout
              </button>
            </div>
          )}
        </div>
      </nav>
      <main className="app-main">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
