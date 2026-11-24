import { api } from '../api'
import { Icon, Logo } from '../components/Icon'
import { useTheme } from '../theme'

/** Sun / moon switch (Figma ThemeToggle); "Theo hệ thống" stays a choice in Cài đặt → Giao diện. */
function ThemeToggle() {
  const { isLight, setTheme } = useTheme()
  return (
    <fieldset className="theme-toggle" aria-label="Giao diện">
      <button
        type="button"
        className={`theme-btn${isLight ? ' is-active' : ''}`}
        aria-pressed={isLight}
        aria-label="Giao diện sáng"
        title="Giao diện sáng"
        onClick={() => void setTheme('light')}
      >
        <Icon name="sun" size={14} />
      </button>
      <button
        type="button"
        className={`theme-btn${isLight ? '' : ' is-active'}`}
        aria-pressed={!isLight}
        aria-label="Giao diện tối"
        title="Giao diện tối"
        onClick={() => void setTheme('dark')}
      >
        <Icon name="moon" size={14} />
      </button>
    </fieldset>
  )
}

/** Custom title bar (frameless window): drag region, logo + name, minimize / maximize / close. */
export function TitleBar() {
  return (
    <header className="titlebar">
      <Logo height={16} className="titlebar-logo" />
      <span className="titlebar-name">Squarel Art Launcher</span>
      <div className="titlebar-buttons">
        <ThemeToggle />
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
