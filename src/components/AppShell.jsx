import { Icon } from "./Icons.jsx";

const NAV = [
  { id: "intro", label: "使用说明", icon: "guide", participant: true },
  { id: "profiles", label: "Agent配置", icon: "profiles" },
  { id: "schemas", label: "Profile结构", icon: "schema", admin: true },
  { id: "models", label: "模型配置", icon: "models", admin: true },
  { id: "interaction", label: "交互", icon: "interaction", admin: true },
  { id: "recaps", label: "Recap", icon: "recaps" },
  { id: "history", label: "历史", icon: "history", admin: true },
  { id: "coding", label: "定性编码", icon: "coding", admin: true },
];

export default function AppShell({ user, page, onPageChange, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="wordmark">ProxyLab</div>
        <nav className="nav-list" aria-label="主导航">
          {NAV.filter((item) => (!item.admin || user.role === "admin") && (!item.participant || user.role === "participant")).map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => onPageChange(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button type="button" className="nav-item nav-logout" onClick={onLogout}>
          <Icon name="logout" />
          <span>退出登录</span>
        </button>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-title">{NAV.find((item) => item.id === page)?.label}</div>
          <div className="user-label">
            <span className="status-dot" />
            {user.id}{user.role === "admin" ? " · 管理员" : " · 参与者"}
          </div>
        </header>
        <main className={`page-content page-${page}`}>{children}</main>
      </div>
    </div>
  );
}
