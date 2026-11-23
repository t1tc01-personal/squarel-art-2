import { api } from '../api'
import { Logo } from '../components/Icon'

/** Custom title bar (frameless window): drag region, logo + name, minimize / maximize / close. */
export function TitleBar() {
  return (
    <header className="titlebar">
      <Logo height={16} className="titlebar-logo" />
      <span className="titlebar-name">Squarel Art Launcher</span>
      <div className="titlebar-buttons">
        <button
          type="button"
          className="winbtn"
          aria-label="Thu nhỏ"
          title="Thu nhỏ"
          onClick={() => void api.minimizeWindow()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" stroke="currentColor" />
          </svg>
        </button>
        {/* The window has a fixed size (1280×800): maximize is drawn like Windows but disabled. */}
        <button type="button" className="winbtn" aria-label="Phóng to" disabled>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="winbtn winbtn-close"
          aria-label="Đóng"
          title="Đóng"
          onClick={() => void api.closeWindow()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  )
}
