import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, ArrowUpRight, AudioLines, BookOpen,
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Compass,
  Filter, Globe2, Headphones, LayoutDashboard, Map,
  LogOut, MapPin, Menu, MoreHorizontal, Pause, Pencil, Play, Plus, Search, Settings2,
  ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { initialSites } from './data.js';
import {
  fetchActiveListeners,
  createSite,
  deleteSite,
  fetchAdminSites,
  fetchRecentActivity,
  fetchSiteNarration,
  heartbeatListener,
  leaveListener,
  apiBaseUrl,
  loginAdmin,
  updateSite,
} from './services/api.js';

const navSections = [
  {
    title: 'TỔNG QUAN',
    items: [{ id: 'dashboard', label: 'Bảng điều khiển', icon: LayoutDashboard }],
  },
  {
    title: 'NỘI DUNG',
    items: [
      { id: 'places', label: 'Quản lý di tích', icon: MapPin, count: '12' },
      { id: 'narrations', label: 'Bài thuyết minh', icon: BookOpen },
      { id: 'languages', label: 'Ngôn ngữ', icon: Globe2 },
    ],
  },
  {
    title: 'HỆ THỐNG',
    items: [
      { id: 'map', label: 'Bản đồ & GPS', icon: Map },
      { id: 'settings', label: 'Cài đặt', icon: Settings2 },
    ],
  },
];

const sectionTitles = {
  dashboard: ['Bảng điều khiển', 'Theo dõi tổng quan hoạt động thuyết minh di tích.'],
  places: ['Quản lý di tích', 'Quản lý thông tin, vị trí và nội dung tại các điểm di tích.'],
  narrations: ['Bài thuyết minh', 'Quản lý nội dung âm thanh theo từng điểm tham quan.'],
  languages: ['Ngôn ngữ', 'Theo dõi nội dung thuyết minh theo từng ngôn ngữ.'],
  map: ['Bản đồ & GPS', 'Thiết lập vị trí và vùng kích hoạt tự động thuyết minh.'],
  settings: ['Cài đặt hệ thống', 'Cấu hình chung cho ứng dụng thuyết minh Di Tích Q1.'],
};

const supportedLanguages = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', name: '中文', flag: '🇨🇳' },
];

const adminAccountStorageKey = 'ditichq1-admin-account';
const defaultAdminAccount = {
  displayName: 'Admin Q1',
  username: 'admin',
  password: '1234',
};
const adminAuthRequired = import.meta.env.VITE_ADMIN_AUTH_REQUIRED === 'true';
const adminTokenStorageKey = 'ditichq1-admin-token';

function readAdminAccount() {
  const storedAccount = localStorage.getItem(adminAccountStorageKey);
  if (!storedAccount) return defaultAdminAccount;
  try {
    const account = JSON.parse(storedAccount);
    if (account && typeof account === 'object'
      && account.displayName && account.username && account.password) return account;
  } catch {
    localStorage.removeItem(adminAccountStorageKey);
  }
  return defaultAdminAccount;
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const listenSiteCode = params.get('listen');
  if (listenSiteCode) {
    return <ListenerDemo siteCode={listenSiteCode} siteName={params.get('name') || 'Điểm di tích Quận 1'} />;
  }
  return <AdminApp />;
}

function AdminApp() {
  const [account, setAccount] = useState(() => adminAuthRequired
    ? { displayName: 'Admin Q1', username: '' }
    : readAdminAccount());
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => adminAuthRequired
      ? Boolean(sessionStorage.getItem(adminTokenStorageKey))
      : sessionStorage.getItem('ditichq1-admin-authenticated') === 'true',
  );

  useEffect(() => {
    const handleExpiredSession = () => {
      setIsAuthenticated(false);
      setAccount({ displayName: 'Admin Q1', username: '' });
    };
    window.addEventListener('ditichq1-admin-auth-expired', handleExpiredSession);
    return () => window.removeEventListener('ditichq1-admin-auth-expired', handleExpiredSession);
  }, []);

  const login = async (username, password) => {
    if (adminAuthRequired) {
      const session = await loginAdmin(username, password);
      sessionStorage.setItem(adminTokenStorageKey, session.access_token);
      setAccount({ displayName: session.username, username: session.username });
      setIsAuthenticated(true);
      return true;
    }
    if (username.trim() !== account.username || password !== account.password) return false;
    sessionStorage.setItem('ditichq1-admin-authenticated', 'true');
    setIsAuthenticated(true);
    return true;
  };

  const updateAccount = (updates) => {
    if (updates.currentPassword !== account.password) {
      throw new Error('Mật khẩu hiện tại không chính xác.');
    }
    const nextAccount = {
      displayName: updates.displayName.trim(),
      username: updates.username.trim(),
      password: updates.newPassword || account.password,
    };
    localStorage.setItem(adminAccountStorageKey, JSON.stringify(nextAccount));
    setAccount(nextAccount);
  };

  const logout = () => {
    sessionStorage.removeItem(adminTokenStorageKey);
    sessionStorage.removeItem('ditichq1-admin-authenticated');
    setIsAuthenticated(false);
    if (adminAuthRequired) setAccount({ displayName: 'Admin Q1', username: '' });
  };

  return isAuthenticated
    ? <AdminDashboard account={account} onAccountUpdate={updateAccount} onLogout={logout} authRequired={adminAuthRequired} />
    : <AdminLogin onLogin={login} />;
}

function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (!await onLogin(username, password)) {
        setError('Tên đăng nhập hoặc mật khẩu không đúng.');
        return;
      }
      setError('');
    } catch (loginError) {
      setError(loginError.message || 'Không thể đăng nhập. Kiểm tra kết nối Backend.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand-mark"><MapPin size={22} strokeWidth={2.4} /></div>
        <span className="login-eyebrow">HERITAGE AUDIO GUIDE</span>
        <h1>Đăng nhập quản trị</h1>
        <p>Đăng nhập để tiếp tục vào không gian quản trị Di Tích Q1.</p>
        <label className="login-field">
          <span>Tên đăng nhập</span>
          <input
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Nhập tên đăng nhập"
            required
          />
        </label>
        <label className="login-field">
          <span>Mật khẩu</span>
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nhập mật khẩu"
            required
          />
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="button button-primary login-submit" type="submit" disabled={submitting}>{submitting ? 'Đang xác thực…' : 'Đăng nhập'}</button>
      </form>
    </main>
  );
}

function AdminDashboard({ account, onAccountUpdate, onLogout, authRequired }) {
  const [activePage, setActivePage] = useState('dashboard');
  const [sites, setSites] = useState(initialSites);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Tất cả trạng thái');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [backendStatus, setBackendStatus] = useState('loading');
  const [listenerStats, setListenerStats] = useState(null);
  const [listenerStatus, setListenerStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    fetchAdminSites()
      .then((records) => {
        if (!active) return;
        setSites(records);
        setBackendStatus('connected');
      })
      .catch(() => {
        if (active) setBackendStatus('offline');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (activePage !== 'dashboard') return undefined;
    let active = true;

    const refreshListenerStats = async () => {
      try {
        const stats = await fetchActiveListeners();
        if (!active) return;
        setListenerStats(stats);
        setListenerStatus('connected');
      } catch {
        if (!active) return;
        setListenerStats(null);
        setListenerStatus('offline');
      }
    };

    refreshListenerStats();
    const interval = window.setInterval(refreshListenerStats, 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activePage]);

  const filteredSites = useMemo(() => sites.filter((site) => {
    const matchesQuery = `${site.name} ${site.address} ${site.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'Tất cả trạng thái' || site.status === statusFilter;
    return matchesQuery && matchesStatus;
  }), [sites, search, statusFilter]);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const openCreate = () => {
    setEditingSite(null);
    setIsModalOpen(true);
  };

  const openEdit = (site) => {
    setEditingSite(site);
    setIsModalOpen(true);
  };

  const saveSite = async (formData) => {
    if (editingSite) {
      await updateSite(editingSite.code, formData);
    } else {
      await createSite(formData);
    }
    const records = await fetchAdminSites();
    setSites(records);
    setBackendStatus('connected');
    setIsModalOpen(false);
    notify(editingSite ? 'Đã cập nhật di tích trong Backend.' : 'Đã thêm di tích vào Backend.');
  };

  const removeSite = async (site) => {
    if (!window.confirm(`Bạn có chắc muốn xóa "${site.name}"? Thao tác này sẽ xóa dữ liệu di tích khỏi Backend.`)) return;
    try {
      await deleteSite(site.code);
      setSites((current) => current.filter((item) => item.code !== site.code));
      notify(`Đã xóa "${site.name}" khỏi Backend.`);
    } catch (error) {
      notify(`Không thể xóa di tích: ${error.message}`);
    }
  };

  const page = sectionTitles[activePage];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><MapPin size={20} strokeWidth={2.4} /></div>
          <div><strong>Di Tích <span>Q1</span></strong><small>HERITAGE AUDIO GUIDE</small></div>
          <button className="icon-button sidebar-close" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-select">
          <div className="workspace-avatar">Q1</div>
          <div className="workspace-copy"><strong>Quản trị viên</strong><small>Không gian dự án</small></div>
        </div>
        <nav className="side-nav" aria-label="Điều hướng chính">
          {navSections.map((section) => (
            <div className="nav-group" key={section.title}>
              <div className="nav-caption">{section.title}</div>
              {section.items.map(({ id, label, icon: Icon, count }) => (
                <button key={id} className={`nav-item ${activePage === id ? 'active' : ''}`} onClick={() => { setActivePage(id); setSidebarOpen(false); }}>
                  <Icon size={18} strokeWidth={1.9} /><span>{label}</span>{count && <span className="nav-count">{id === 'places' ? sites.length : count}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card" hidden>
            <div className="help-icon"><CircleHelp size={17} /></div>
            <strong>Cần hỗ trợ?</strong>
            <p>Xem hướng dẫn sử dụng trang quản trị.</p>
            <button onClick={() => notify('Tài liệu hướng dẫn sẽ sớm được cập nhật.')}>Trung tâm trợ giúp <ArrowRight size={14} /></button>
          </div>
          <button className="profile-row" onClick={() => setActivePage('settings')}>
            <div className="profile-avatar">AD</div>
            <div className="profile-copy"><strong>{account.displayName}</strong><small>Quản trị viên</small></div>
            <MoreHorizontal size={20} className="muted-icon" />
          </button>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Mở menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumb"><span>Di Tích Q1</span><ChevronRight size={14} /><strong>{page[0]}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-user"><div className="profile-avatar">AD</div><span>{account.displayName}</span></div>
            <button className="logout-button" onClick={onLogout}><LogOut size={15} /><span>Đăng xuất</span></button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> KHÔNG GIAN QUẢN TRỊ</div>
              <h1>{page[0]}</h1>
              <p>{page[1]}</p>
            </div>
            {activePage === 'places' && (
              <button className="button button-primary" onClick={openCreate}><Plus size={17} /> Thêm di tích</button>
            )}
          </div>

          {activePage === 'dashboard' && <Dashboard sites={sites} onNavigate={setActivePage} listenerStats={listenerStats} listenerStatus={listenerStatus} />}
          {activePage === 'places' && <PlacesPage sites={filteredSites} totalSites={sites.length} allSites={sites} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onEdit={openEdit} onDelete={removeSite} />}
          {activePage === 'narrations' && <NarrationsPage notify={notify} />}
          {activePage === 'languages' && <LanguagesPage sites={sites} />}
          {activePage === 'map' && <MapPage notify={notify} siteCount={sites.length} />}
          {activePage === 'settings' && <SettingsPage account={account} onAccountUpdate={onAccountUpdate} notify={notify} authRequired={authRequired} />}
        </div>
        <footer className="footer"><span>© 2026 Di Tích Q1</span><span>Hệ thống thuyết minh di tích lịch sử Quận 1</span><span className="system-status"><i /> {backendStatus === 'connected' ? 'Đã kết nối Backend' : backendStatus === 'offline' ? 'Đang dùng dữ liệu mẫu · Backend chưa kết nối' : 'Đang kết nối Backend…'}</span></footer>
      </main>

      {isModalOpen && <SiteModal site={editingSite} onClose={() => setIsModalOpen(false)} onSave={saveSite} />}
      {toast && <div className="toast"><span className="toast-check"><Check size={15} /></span>{toast}</div>}
    </div>
  );
}

function Dashboard({ sites, onNavigate, listenerStats, listenerStatus }) {
  const activeCount = sites.filter((site) => site.status === 'Đang hoạt động').length;
  const narrationCount = sites.length * supportedLanguages.length;
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityError, setActivityError] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const demoSite = sites.find((site) => String(site.id) === selectedSiteId)
    || sites.find((site) => getSiteCode(site) === 'dinh-doc-lap')
    || sites[0];
  const demoSiteCode = demoSite ? getSiteCode(demoSite) : 'dinh-doc-lap';
  const demoUrl = new URL(window.location.href);
  demoUrl.search = new URLSearchParams({
    listen: demoSiteCode,
    name: demoSite?.name || 'Điểm di tích Quận 1',
  }).toString();
  const siteListenerCount = listenerStats?.by_site?.find((item) => item.site_code === demoSiteCode)?.count || 0;

  useEffect(() => {
    let active = true;
    const refreshRecentActivity = async () => {
      try {
        const events = await fetchRecentActivity();
        if (!active) return;
        setRecentActivity(events);
        setActivityError('');
      } catch (error) {
        if (active) setActivityError(error.message);
      }
    };

    refreshRecentActivity();
    const interval = window.setInterval(refreshRecentActivity, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);
  return (
    <div className="dashboard-content">
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="welcome-chip"><Sparkles size={13} /> TỔNG QUAN HÔM NAY</div>
          <h2>Xin chào, Admin <span>👋</span></h2>
          <p>Cùng xem lại hoạt động thuyết minh di tích tại Quận 1 hôm nay.</p>
          <button className="welcome-link" onClick={() => onNavigate('places')}>Quản lý điểm di tích <ArrowRight size={15} /></button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="sun-disc" /><div className="art-building building-back"><span /><span /><span /></div><div className="art-building building-front"><span /><span /><span /><span /></div><div className="art-ground" />
          <div className="art-pin"><MapPin size={17} fill="currentColor" /></div>
        </div>
      </section>

      <section className="live-demo-panel panel">
        <div className="live-demo-copy">
          <div className="live-demo-eyebrow"><span className="live-indicator" /> DEMO ĐA THIẾT BỊ</div>
          <h3>Quét mã QR để nghe thử</h3>
          <p>Mở trang thuyết minh trên điện thoại. Số thiết bị sẽ cập nhật trực tiếp và tự giảm khi kết thúc phiên.</p>
          <label className="demo-site-select">
            <span>Điểm di tích</span>
            <select
              value={demoSite ? String(demoSite.id) : ''}
              onChange={(event) => setSelectedSiteId(event.target.value)}
              aria-label="Chọn di tích dùng cho mã QR demo"
            >
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>
          <div className="demo-device-count">
            <i className={`demo-device-indicator ${listenerStatus}`} aria-label={listenerStatus === 'connected' ? 'Đang kết nối' : 'Chưa kết nối'} />
            <strong>{listenerStatus === 'connected' ? siteListenerCount : '—'}</strong>
            <span>thiết bị tại {demoSite?.name || 'điểm này'}</span>
          </div>
        </div>
        <div className="live-demo-qr">
          <div className="qr-frame">
            <QRCodeSVG value={demoUrl.toString()} size={148} level="M" includeMargin />
          </div>
          <span>Quét bằng camera điện thoại</span>
          <button className="text-button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(demoUrl.toString());
              window.alert('Đã sao chép đường dẫn demo.');
            } catch {
              window.prompt('Sao chép đường dẫn demo này:', demoUrl.toString());
            }
          }}>Sao chép đường dẫn <ArrowRight size={14} /></button>
          {['localhost', '127.0.0.1'].includes(window.location.hostname) && (
            <small className="qr-network-hint">Để điện thoại mở được QR, chạy web bằng --host 0.0.0.0 và truy cập dashboard bằng IP LAN của máy tính.</small>
          )}
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Thiết bị đang nghe" value={listenerStatus === 'connected' ? String(listenerStats?.active_count ?? 0) : '—'} change={listenerStatus === 'connected' ? 'TRỰC TIẾP' : 'CHƯA KẾT NỐI'} positive={listenerStatus === 'connected'} icon={Headphones} iconTone="blue" note="từ các phiên nghe còn hoạt động" />
        <StatCard label="Điểm di tích" value={String(sites.length)} change={`${activeCount} đang hoạt động`} positive icon={MapPin} iconTone="orange" note="đồng bộ từ Backend" />
        <StatCard label="Bài thuyết minh" value={String(narrationCount)} change="có thể tạo audio" positive icon={AudioLines} iconTone="violet" note={`${sites.length} di tích × ${supportedLanguages.length} ngôn ngữ`} />
        <StatCard label="Ngôn ngữ hỗ trợ" value={String(supportedLanguages.length)} change="đồng bộ với Backend" positive icon={Globe2} iconTone="green" note="Việt · Anh · Nhật · Trung" />
      </section>

      <section className="analytics-grid">
        <div className="panel listening-panel">
          <div className="panel-heading">
            <div><h3>Lượt nghe thuyết minh</h3><p>Thống kê hoạt động của người dùng</p></div>
            <button className="select-button" onClick={() => {}}><span className="select-period-dot" /> 7 ngày qua <ChevronDown size={15} /></button>
          </div>
          <div className="chart-legend"><span className="legend-dot" /> Lượt nghe <span className="legend-period">01 — 07 Tháng 10, 2026</span></div>
          <div className="chart-wrap">
            <div className="chart-ylabels"><span>1.000</span><span>750</span><span>500</span><span>250</span><span>0</span></div>
            <div className="chart-area">
              <div className="chart-gridlines"><i /><i /><i /><i /><i /></div>
              <svg viewBox="0 0 720 204" preserveAspectRatio="none" role="img" aria-label="Biểu đồ lượt nghe tăng dần trong 7 ngày">
                <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ea5538" stopOpacity=".18" /><stop offset="100%" stopColor="#ea5538" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 157 C35 145 48 149 74 136 S114 143 145 119 S190 123 218 111 S263 118 291 88 S340 99 365 82 S411 93 437 68 S478 84 510 62 S553 73 583 43 S625 55 654 33 S691 39 720 16 L720 204 L0 204 Z" fill="url(#chartFill)" />
                <path d="M0 157 C35 145 48 149 74 136 S114 143 145 119 S190 123 218 111 S263 118 291 88 S340 99 365 82 S411 93 437 68 S478 84 510 62 S553 73 583 43 S625 55 654 33 S691 39 720 16" fill="none" stroke="#e95a3f" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                <circle cx="720" cy="16" r="5.5" fill="#fff" stroke="#e95a3f" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="chart-xlabels"><span>T.2</span><span>T.3</span><span>T.4</span><span>T.5</span><span>T.6</span><span>T.7</span><span>CN</span></div>
            </div>
          </div>
          <div className="chart-bottom"><span><ArrowUpRight size={15} /> <strong>12,8%</strong> tăng so với tuần trước</span><button onClick={() => {}}>Xem báo cáo <ArrowRight size={14} /></button></div>
        </div>

        <div className="panel top-places-panel">
          <div className="panel-heading"><div><h3>Di tích nổi bật</h3><p>Được nghe nhiều nhất tuần này</p></div><button className="more-button" aria-label="Tùy chọn"><MoreHorizontal size={20} /></button></div>
          <div className="top-place-list">
            <TopPlace rank="01" title="Dinh Độc Lập" subtitle="Lượt nghe" value="2,846" percent={88} tone="orange" />
            <TopPlace rank="02" title="Nhà thờ Đức Bà" subtitle="Lượt nghe" value="2,104" percent={69} tone="blue" />
            <TopPlace rank="03" title="Bưu điện Trung tâm" subtitle="Lượt nghe" value="1,762" percent={52} tone="green" />
          </div>
          <button className="panel-link" onClick={() => onNavigate('places')}>Xem tất cả di tích <ArrowRight size={15} /></button>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel recent-panel">
          <div className="panel-heading"><div><h3>Di tích từ Backend</h3><p>Danh sách hiện tại được đồng bộ trực tiếp</p></div><button className="text-button" onClick={() => onNavigate('places')}>Xem tất cả <ArrowRight size={14} /></button></div>
          <div className="recent-table-wrap">
            <table className="recent-table">
              <thead><tr><th>TÊN DI TÍCH</th><th>ĐỊA CHỈ</th><th>NGÔN NGỮ</th><th>TRẠNG THÁI</th></tr></thead>
              <tbody>
                {sites.slice(0, 4).map((site) => <tr key={site.id}>
                  <td><div className="place-cell"><PlaceThumb site={site} /><div><strong>{site.name}</strong><small>{site.category}</small></div></div></td>
                  <td className="address-cell">{site.address}</td>
                  <td><LanguagePills codes={site.languages} /></td>
                  <td><StatusBadge status={site.status} /></td>
                </tr>)}
                {sites.length === 0 && <tr><td colSpan="4" className="recent-empty">Backend chưa có di tích để hiển thị.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel activity-panel">
          <div className="panel-heading"><div><h3>Hoạt động gần đây</h3><p>Thao tác di tích được ghi nhận trong Backend</p></div></div>
          <div className="activity-list">
            {recentActivity.map((event) => {
              const activity = activityDetails[event.action];
              if (!activity) return null;
              return <ActivityItem
                key={event._id}
                icon={activity.icon}
                tone={activity.tone}
                title={activity.title}
                description={event.site_name}
                time={formatActivityTime(event.created_at)}
              />;
            })}
            {recentActivity.length === 0 && (
              <div className="activity-empty">
                {activityError || 'Chưa có thao tác thêm, sửa hoặc xóa di tích được ghi nhận.'}
              </div>
            )}
          </div>
          <button className="panel-link activity-link" onClick={() => onNavigate('places')}>Quản lý di tích <ArrowRight size={15} /></button>
        </div>
      </section>

      <section className="bottom-grid lower-grid">
        <div className="panel map-panel">
          <div className="panel-heading"><div><h3>Bản đồ di tích</h3><p>12 điểm thuyết minh tại Quận 1</p></div><button className="mini-outline" onClick={() => onNavigate('map')}>Mở bản đồ <ArrowRight size={13} /></button></div>
          <div className="map-preview">
            <div className="map-block block-a" /><div className="map-block block-b" /><div className="map-block block-c" /><div className="map-block block-d" />
            <div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" />
            <div className="map-water" /><span className="map-label label-dong-khoi">Đ. Đồng Khởi</span><span className="map-label label-le-loi">Đ. Lê Lợi</span><span className="map-label label-nam-ky">Nam Kỳ Khởi Nghĩa</span>
            <div className="map-marker marker-one"><MapPin size={15} fill="currentColor" /></div><div className="map-marker marker-two"><MapPin size={15} fill="currentColor" /></div><div className="map-marker marker-three"><MapPin size={15} fill="currentColor" /></div>
            <div className="map-legend"><i /> Điểm đang hoạt động <i className="legend-warn" /> Bản nháp</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function getSiteCode(site) {
  if (site.code) return site.code;
  return site.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getListenerSessionId() {
  const storedId = sessionStorage.getItem('ditichq1-listener-session');
  if (storedId) return storedId;
  const sessionId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const value = Math.floor(Math.random() * 16);
      return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
    });
  sessionStorage.setItem('ditichq1-listener-session', sessionId);
  return sessionId;
}

function ListenerDemo({ siteCode, siteName }) {
  const narrationLanguages = [
    { code: 'vi', name: 'Tiếng Việt' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'zh-CN', name: '中文' },
  ];
  const [sessionId] = useState(getListenerSessionId);
  const [selectedLanguage, setSelectedLanguage] = useState('vi');
  const [connection, setConnection] = useState('connecting');
  const [narration, setNarration] = useState(null);
  const [narrationLoading, setNarrationLoading] = useState(true);
  const [narrationError, setNarrationError] = useState('');
  const [narrationAttempt, setNarrationAttempt] = useState(0);
  const [audioPlaybackError, setAudioPlaybackError] = useState('');
  const selectedLanguageInfo = narrationLanguages.find(
    (language) => language.code === selectedLanguage,
  );

  useEffect(() => {
    let active = true;
    const sendHeartbeat = async () => {
      try {
        await heartbeatListener(sessionId, siteCode);
        if (active) setConnection('connected');
      } catch {
        if (active) setConnection('offline');
      }
    };
    const leave = () => {
      leaveListener(sessionId, true).catch(() => {});
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, 10000);
    window.addEventListener('pagehide', leave);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('pagehide', leave);
    };
  }, [sessionId, siteCode]);

  useEffect(() => {
    let active = true;
    setNarration(null);
    setNarrationLoading(true);
    setNarrationError('');
    setAudioPlaybackError('');
    fetchSiteNarration(siteCode, selectedLanguage)
      .then((record) => {
        if (!active) return;
        setNarration(record);
      })
      .catch((error) => {
        if (!active) return;
        setNarrationError(error.message);
      })
      .finally(() => {
        if (active) setNarrationLoading(false);
      });
    return () => { active = false; };
  }, [siteCode, selectedLanguage, narrationAttempt]);

  const audioUrl = narration?.audio_url
    ? (narration.audio_url.startsWith('http') ? narration.audio_url : `${apiBaseUrl}${narration.audio_url}`)
    : '';

  return (
    <main className="listener-page">
      <header className="listener-header">
        <a href={window.location.pathname} className="listener-brand">
          <span><MapPin size={19} /></span>
          <strong>Di Tích <i>Q1</i></strong>
        </a>
        <span className={`listener-live ${connection === 'connected' ? 'is-online' : ''}`}>
          <i /> {connection === 'connected' ? 'Đã kết nối demo' : connection === 'offline' ? 'Chưa kết nối được Backend' : 'Đang kết nối…'}
        </span>
      </header>
      <section className="listener-card">
        <div className="listener-card-icon"><AudioLines size={26} /></div>
        <span className="listener-kicker">THUYẾT MINH DI TÍCH · QUẬN 1</span>
        <h1>{narration?.name || siteName}</h1>
        <p>Chào mừng bạn đến với trải nghiệm thuyết minh đa ngôn ngữ. Nhấn phát để bắt đầu nghe nội dung tại điểm tham quan.</p>
        <div className="listener-session-state">
          <span className={connection === 'connected' ? 'session-dot connected' : 'session-dot'} />
          {connection === 'connected'
            ? 'Thiết bị của bạn đang được tính trong dashboard.'
            : 'Dashboard sẽ cập nhật khi kết nối với Backend thành công.'}
        </div>
        <label className="listener-language">
          <span>Ngôn ngữ thuyết minh</span>
          <select
            aria-label="Ngôn ngữ thuyết minh"
            value={selectedLanguage}
            onChange={(event) => {
              setNarration(null);
              setNarrationLoading(true);
              setSelectedLanguage(event.target.value);
            }}
          >
            {narrationLanguages.map((language) => (
              <option key={language.code} value={language.code}>{language.name}</option>
            ))}
          </select>
        </label>
        {audioUrl ? (
          <div className="listener-audio">
            <strong><Headphones size={17} /> Bài thuyết minh · {selectedLanguageInfo?.name}</strong>
            <audio
              key={`${selectedLanguage}-${audioUrl}`}
              controls
              preload="none"
              src={audioUrl}
              onError={() => setAudioPlaybackError(`Không phát được audio ${selectedLanguageInfo?.name} từ Backend.`)}
            >Trình duyệt không hỗ trợ phát âm thanh.</audio>
          </div>
        ) : (
          <div className="listener-audio-placeholder">
            {narrationLoading ? `Đang tải bài thuyết minh ${selectedLanguageInfo?.name}…` : narrationError}
          </div>
        )}
        {audioPlaybackError && <p className="listener-audio-warning">{audioPlaybackError}</p>}
        {narrationError && !narrationLoading && (
          <div className="listener-speech-actions">
            <button className="listener-retry" onClick={() => setNarrationAttempt((attempt) => attempt + 1)}>Thử tải lại</button>
          </div>
        )}
      </section>
      <footer className="listener-footer">Phiên nghe sẽ tự kết thúc khi bạn rời khỏi trang.</footer>
    </main>
  );
}

function StatCard({ label, value, change, positive, icon: Icon, iconTone, note }) {
  return <div className="stat-card"><div className={`stat-icon ${iconTone}`}><Icon size={19} strokeWidth={2} /></div><span className="stat-label">{label}</span><div className="stat-value-row"><strong>{value}</strong><span className={`stat-change ${positive ? 'positive' : ''}`}>{positive ? <ArrowUpRight size={13} /> : <Activity size={13} />}{change}</span></div><span className="stat-note">{note}</span></div>;
}

function TopPlace({ rank, title, subtitle, value, percent, tone }) {
  return <div className="top-place"><span className="top-rank">{rank}</span><div className={`top-place-icon ${tone}`}><MapPin size={16} /></div><div className="top-place-copy"><strong>{title}</strong><span>{subtitle}</span></div><div className="top-place-score"><strong>{value}</strong><div className="mini-progress"><i style={{ width: `${percent}%` }} /></div></div></div>;
}

function PlaceThumb({ site }) {
  return site.image ? <img className={`place-thumb ${site.color}`} src={site.image} alt="" /> : <div className={`place-thumb ${site.color}`}><MapPin size={17} /></div>;
}

function LanguagePills({ codes }) {
  return <div className="language-pills">{codes.map((code) => <span key={code} title={code}>{code}</span>)}</div>;
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status === 'Bản nháp' ? 'draft' : 'published'}`}><i />{status}</span>;
}

function ActivityItem({ icon: Icon, tone, title, description, time }) {
  return <div className="activity-item"><div className={`activity-icon ${tone}`}><Icon size={16} /></div><div className="activity-copy"><strong>{title}</strong><span>{description}</span><small>{time}</small></div></div>;
}

const activityDetails = {
  created: { icon: MapPin, tone: 'orange', title: 'Đã thêm di tích' },
  updated: { icon: Activity, tone: 'blue', title: 'Đã cập nhật di tích' },
  deleted: { icon: Trash2, tone: 'violet', title: 'Đã xóa di tích' },
};

function formatActivityTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Thời gian không xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function PlacesPage({ sites, totalSites, allSites, search, setSearch, statusFilter, setStatusFilter, onEdit, onDelete }) {
  const activeCount = allSites.filter((site) => site.status === 'Đang hoạt động').length;
  const draftCount = allSites.length - activeCount;
  return (
    <section className="panel places-panel">
      <div className="places-summary"><div><strong>{totalSites} di tích</strong><span> từ Backend</span></div><div className="summary-status"><span><i /> {activeCount} đang hoạt động</span><span className="draft-summary"><i /> {draftCount} bản nháp</span></div></div>
      <div className="table-toolbar">
        <div className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên di tích, địa chỉ..." /></div>
        <label className="filter-select"><Filter size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Tất cả trạng thái</option><option>Đang hoạt động</option><option>Bản nháp</option></select><ChevronDown size={14} /></label>
        <button className="button button-secondary small-button" onClick={() => setStatusFilter('Tất cả trạng thái')}><Filter size={15} /> Bộ lọc</button>
      </div>
      <div className="places-table-wrap">
        <table className="places-table"><thead><tr><th><input type="checkbox" aria-label="Chọn tất cả" /></th><th>TÊN DI TÍCH</th><th>VỊ TRÍ</th><th>NGÔN NGỮ</th><th>BÀI THUYẾT MINH</th><th>TRẠNG THÁI</th><th /></tr></thead>
          <tbody>{sites.map((site) => <tr key={site.id}>
            <td><input type="checkbox" aria-label={`Chọn ${site.name}`} /></td>
            <td><div className="place-cell"><PlaceThumb site={site} /><div><strong>{site.name}</strong><small>{site.category}</small></div></div></td>
            <td className="address-cell"><MapPin size={13} />{site.address}</td>
            <td><LanguagePills codes={site.languages} /></td>
            <td className="narration-count"><AudioLines size={15} /> {site.narrations} bài</td>
            <td><StatusBadge status={site.status} /></td>
            <td><div className="site-row-actions">
              <button className="row-more" aria-label={`Sửa ${site.name}`} title="Sửa di tích" onClick={() => onEdit(site)}><Pencil size={14} /><span>Sửa</span></button>
              <button className="row-more delete-action" aria-label={`Xóa ${site.name}`} title="Xóa di tích" onClick={() => onDelete(site)}><Trash2 size={14} /><span>Xóa</span></button>
            </div></td>
          </tr>)}</tbody>
        </table>
        {sites.length === 0 && <div className="empty-state"><Search size={23} /><strong>Không tìm thấy di tích</strong><span>Thử thay đổi từ khóa hoặc bộ lọc của bạn.</span></div>}
      </div>
      <div className="pagination"><span>Hiển thị <strong>{sites.length}</strong> trong <strong>{totalSites}</strong> di tích</span><div><button aria-label="Trang trước" disabled><ChevronLeft size={16} /></button><button className="current-page">1</button><button aria-label="Trang sau" disabled><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function NarrationsPage({ notify }) {
  const [selectedLang, setSelectedLang] = useState('Tất cả ngôn ngữ');
  const [search, setSearch] = useState('');
  const [sites, setSites] = useState([]);
  const [loadingId, setLoadingId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioError, setAudioError] = useState('');
  const audioRef = useRef(null);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    fetchAdminSites()
      .then((records) => {
        if (active) setSites(records);
      })
      .catch((error) => {
        if (active) notify(`Không tải được danh sách di tích: ${error.message}`);
      });
    return () => {
      active = false;
      requestId.current += 1;
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!audioUrl) return undefined;
    const player = audioRef.current;
    if (!player) return undefined;
    let active = true;
    player.play()
      .then(() => {
        if (active) {
          setIsPlaying(true);
          setAudioError('');
        }
      })
      .catch((error) => {
        if (active) {
          setIsPlaying(false);
          setAudioError(`Trình duyệt chưa tự phát được audio. Dùng trình phát bên dưới để bấm phát: ${error.message}`);
        }
      });
    return () => {
      active = false;
      player.pause();
    };
  }, [audioUrl]);

  const narrationLanguages = selectedLang === 'Tất cả ngôn ngữ'
    ? supportedLanguages
    : supportedLanguages.filter((language) => language.name === selectedLang);
  const narrations = sites.flatMap((site) => narrationLanguages.map((language) => ({
    id: `${site.code}-${language.code}`,
    site,
    language,
  }))).filter(({ site }) => (
    `${site.name} ${site.category} ${site.address}`.toLowerCase().includes(search.trim().toLowerCase())
  ));
  const playNarration = async (item) => {
    const id = item.id;
    const player = audioRef.current;
    if (!player) return;

    if (activeId === id && player.src) {
      if (player.paused) {
        try {
          await player.play();
          setIsPlaying(true);
          setAudioError('');
        } catch (error) {
          setAudioError(`Không phát được bài thuyết minh: ${error.message}`);
        }
      } else {
        player.pause();
        setIsPlaying(false);
      }
      return;
    }

    const currentRequest = ++requestId.current;
    setLoadingId(id);
    setActiveId('');
    setIsPlaying(false);
    setAudioUrl('');
    setAudioError('');
    player.pause();
    player.removeAttribute('src');
    player.load();

    try {
      if (!item.site.code) {
        throw new Error(`Không tìm thấy mã di tích "${item.site.name}" trong Backend.`);
      }
      const narration = await fetchSiteNarration(
        item.site.code,
        item.language.code,
      );
      if (currentRequest !== requestId.current) return;
      if (!narration.audio_url) {
        throw new Error('Backend chưa tạo file audio cho bài thuyết minh này.');
      }
      const resolvedAudioUrl = narration.audio_url.startsWith('http')
        ? narration.audio_url
        : `${apiBaseUrl}${narration.audio_url}`;
      setAudioUrl(resolvedAudioUrl);
      setActiveId(id);
    } catch (error) {
      if (currentRequest === requestId.current) {
        setAudioError(error.message);
        notify(error.message);
      }
    } finally {
      if (currentRequest === requestId.current) setLoadingId('');
    }
  };

  return <section className="panel content-list-panel"><div className="content-toolbar"><div className="table-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên di tích, địa chỉ..." /></div><label className="filter-select"><Globe2 size={15} /><select value={selectedLang} onChange={(event) => setSelectedLang(event.target.value)}><option>Tất cả ngôn ngữ</option><option>Tiếng Việt</option><option>English</option><option>日本語</option><option>中文</option></select><ChevronDown size={14} /></label><span className="narration-total">{narrations.length} bài thuyết minh</span></div>
    <div className="narration-list">{narrations.map((item, index) => {
      const isActive = activeId === item.id;
      return <div className="narration-row" key={item.id}><div className={`narration-icon tone-${index % 4}`}><AudioLines size={19} /></div><div className="narration-title"><strong>{item.site.name}</strong><span>{item.site.category} <i /> {item.language.name}</span></div><button className="play-preview" aria-label={loadingId === item.id ? `Đang tải ${item.site.name}` : isActive && isPlaying ? `Tạm dừng ${item.site.name}` : `Nghe ${item.site.name}`} title={loadingId === item.id ? 'Đang tải audio' : isActive && isPlaying ? 'Tạm dừng' : 'Nghe thử'} disabled={loadingId === item.id || sites.length === 0} onClick={() => playNarration(item)}>{loadingId === item.id ? <span className="play-loading">…</span> : isActive && isPlaying ? <Pause size={15} /> : <Play size={15} />}</button><button className="row-more" aria-label="Tùy chọn"><MoreHorizontal size={18} /></button></div>;
    })}{narrations.length === 0 && <div className="empty-state"><Search size={23} /><strong>Không tìm thấy bài thuyết minh</strong><span>Thay đổi từ khóa hoặc bộ lọc để xem các di tích hiện có.</span></div>}</div>
    <div className="narration-audio-player" hidden={!audioUrl}><strong>{narrations.find((item) => item.id === activeId)?.site.name}</strong><audio ref={audioRef} controls={Boolean(audioUrl)} preload="none" src={audioUrl || undefined} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => { setActiveId(''); setIsPlaying(false); }} onError={() => { if (audioUrl) setAudioError('Không tải được file audio từ Backend.'); }} /></div>
    {audioError && <p className="listener-audio-warning">{audioError}</p>}
  </section>;
}

function LanguagesPage({ sites }) {
  const languageCoverage = supportedLanguages.length
    ? (supportedLanguages.length / supportedLanguages.length) * 100
    : 0;
  return <div className="language-page">
    <section className="panel language-overview">
      <div className="language-overview-icon"><Globe2 size={22} /></div>
      <div><span>NGÔN NGỮ BACKEND HỖ TRỢ</span><strong>{supportedLanguages.length} <small>/ {supportedLanguages.length}</small></strong></div>
      <div className="language-overview-bar"><div><i style={{ width: `${languageCoverage}%` }} /></div><small>API hỗ trợ dịch và tạo audio theo yêu cầu</small></div>
    </section>
    <section className="panel language-panel">
      <div className="panel-heading"><div><h3>Danh sách ngôn ngữ</h3><p>Đồng bộ với ngôn ngữ dịch và tạo audio của Backend</p></div></div>
      <div className="language-list">{supportedLanguages.map((language) => (
        <div className="language-row" key={language.code}>
          <span className="language-flag">{language.flag}</span>
          <div className="language-name"><strong>{language.name}</strong><small>{language.code}</small></div>
          <div className="language-places"><strong>{sites.length}</strong><span>di tích có thể thuyết minh</span></div>
          <span className="language-supported">Được hỗ trợ</span>
        </div>
      ))}</div>
    </section>
  </div>;
}

function MapPage({ notify, siteCount }) {
  return <div className="map-page"><section className="panel map-large-panel"><div className="panel-heading"><div><h3>Vị trí các điểm di tích</h3><p>Quận 1, Thành phố Hồ Chí Minh · {siteCount} điểm mẫu</p></div><button className="button button-secondary small-button" onClick={() => notify('Đang làm mới vị trí GPS.')}><Compass size={15} /> Làm mới vị trí</button></div><div className="large-map map-preview"><div className="map-block block-a" /><div className="map-block block-b" /><div className="map-block block-c" /><div className="map-block block-d" /><div className="map-block block-e" /><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" /><div className="map-water" /><span className="map-label label-dong-khoi">Đ. Đồng Khởi</span><span className="map-label label-le-loi">Đ. Lê Lợi</span><span className="map-label label-nam-ky">Nam Kỳ Khởi Nghĩa</span><div className="map-marker marker-one"><MapPin size={16} fill="currentColor" /></div><div className="map-marker marker-two"><MapPin size={16} fill="currentColor" /></div><div className="map-marker marker-three"><MapPin size={16} fill="currentColor" /></div><div className="map-marker marker-four"><MapPin size={16} fill="currentColor" /></div><div className="map-legend"><i /> Đang hoạt động <i className="legend-warn" /> Bản nháp</div><button className="map-zoom" onClick={() => notify('Bản đồ đã được phóng to.')}><Plus size={17} /><span />−</button></div></section><section className="gps-side"><div className="panel gps-status-panel"><div className="gps-status-head"><span className="gps-icon"><ShieldCheck size={19} /></span><span className="gps-online"><i /> HOẠT ĐỘNG</span></div><h3>GPS & Geofence</h3><p>Thiết lập bán kính để ứng dụng tự động phát thuyết minh khi khách đến gần di tích.</p><div className="radius-setting"><div><span>Bán kính kích hoạt</span><strong>50 <small>mét</small></strong></div><input type="range" min="20" max="200" defaultValue="50" /><div className="range-labels"><span>20m</span><span>200m</span></div></div><button className="button button-primary full-button" onClick={() => notify('Đã lưu cấu hình GPS.')}>Lưu cấu hình</button></div><div className="panel gps-help-panel"><div className="gps-help-icon"><CircleHelp size={17} /></div><div><strong>Về vùng kích hoạt</strong><p>Bán kính đề xuất từ 30–80m để đảm bảo trải nghiệm phát tự động chính xác trong khu vực trung tâm.</p></div></div></section></div>;
}

function SettingsPage({ account, onAccountUpdate, notify, authRequired }) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [username, setUsername] = useState(account.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  if (authRequired) {
    return (
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div><h3>Thông tin tài khoản</h3><p>Tài khoản quản trị được xác thực an toàn ở Backend.</p></div>
        </div>
        <div className="settings-form">
          <label>Tên đăng nhập
            <input value={account.username} readOnly />
          </label>
          <p className="settings-security-note">Để đổi thông tin đăng nhập, hãy cập nhật biến môi trường ADMIN_USERNAME hoặc ADMIN_PASSWORD trong Render. Mật khẩu không được lưu trong trình duyệt.</p>
        </div>
      </section>
    );
  }

  const saveAccount = (event) => {
    event.preventDefault();
    if (displayName.trim().length < 2 || username.trim().length < 3) {
      setError('Tên hiển thị cần ít nhất 2 ký tự và tên đăng nhập ít nhất 3 ký tự.');
      return;
    }
    if (!currentPassword) {
      setError('Nhập mật khẩu hiện tại để xác nhận thay đổi.');
      return;
    }
    if (newPassword && newPassword.length < 4) {
      setError('Mật khẩu mới cần có ít nhất 4 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu mới và xác nhận mật khẩu không khớp.');
      return;
    }

    try {
      onAccountUpdate({ displayName, username, currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      notify('Đã cập nhật thông tin tài khoản.');
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div><h3>Thông tin tài khoản</h3><p>Cập nhật thông tin dùng để đăng nhập quản trị.</p></div>
      </div>
      <form className="settings-form" onSubmit={saveAccount}>
        <label>Tên hiển thị
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required />
        </label>
        <label>Tên đăng nhập
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label>Mật khẩu hiện tại <em>*</em>
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        <label>Mật khẩu mới <span className="field-hint">(để trống nếu không đổi)</span>
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <label>Xác nhận mật khẩu mới
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        </label>
        {error && <div className="settings-error" role="alert">{error}</div>}
        <button className="button button-primary settings-save" type="submit">Lưu thông tin tài khoản</button>
      </form>
      <p className="settings-security-note">Lưu ý: đăng nhập hiện tại là tiện ích demo phía trình duyệt, chưa thay thế xác thực an toàn ở Backend.</p>
    </section>
  );
}

function SiteModal({ site, onClose, onSave }) {
  const [name, setName] = useState(site?.name ?? '');
  const [code, setCode] = useState(site?.code ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [category, setCategory] = useState(site?.category ?? 'Di tích lịch sử');
  const [lat, setLat] = useState(site?.lat === '' || site?.lat == null ? '' : String(site.lat));
  const [lng, setLng] = useState(site?.lng === '' || site?.lng == null ? '' : String(site.lng));
  const [description, setDescription] = useState(site?.description ?? '');
  const [status, setStatus] = useState(site?.status ?? 'Bản nháp');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2 || address.trim().length < 2 || description.trim().length < 10) {
      setError('Nhập tên, địa chỉ hợp lệ và nội dung thuyết minh ít nhất 10 ký tự.');
      return;
    }
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!lat.trim() || !lng.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Tọa độ không hợp lệ. Vĩ độ từ -90 đến 90, kinh độ từ -180 đến 180.');
      return;
    }
    const siteCode = site?.code || code.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteCode) || siteCode.length < 2 || siteCode.length > 80) {
      setError('Mã di tích chỉ gồm chữ thường, số và dấu gạch ngang, ví dụ: dinh-doc-lap.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        code: siteCode,
        name: name.trim(),
        address: address.trim(),
        category,
        lat: latitude,
        lng: longitude,
        description: description.trim(),
        status,
      });
    } catch (saveError) {
      setError(saveError.message);
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="site-modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="modal-icon"><MapPin size={18} /></span><div><h2>{site ? 'Chỉnh sửa di tích' : 'Thêm di tích mới'}</h2><p>Thông tin sẽ được lưu trực tiếp vào Backend.</p></div></div><button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X size={19} /></button></div>
    <div className="modal-body">
      <label>Tên di tích <em>*</em><input autoFocus value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!site) setCode(slugify(value)); setError(''); }} placeholder="Ví dụ: Dinh Độc Lập" /></label>
      <label>Mã di tích <em>*</em><input value={code} readOnly={Boolean(site)} onChange={(event) => { setCode(event.target.value); setError(''); }} placeholder="dinh-doc-lap" /><small className="field-hint">Mã URL duy nhất, dùng chữ thường, số và dấu gạch ngang.</small></label>
      <label>Địa chỉ <em>*</em><div className="input-with-icon"><MapPin size={15} /><input value={address} onChange={(event) => { setAddress(event.target.value); setError(''); }} placeholder="Số nhà, tên đường..." /></div></label>
      <div className="form-columns"><label>Vĩ độ GPS <em>*</em><input type="number" min="-90" max="90" step="any" value={lat} onChange={(event) => setLat(event.target.value)} placeholder="10.7769" /></label><label>Kinh độ GPS <em>*</em><input type="number" min="-180" max="180" step="any" value={lng} onChange={(event) => setLng(event.target.value)} placeholder="106.6952" /></label></div>
      <div className="form-columns"><label>Loại hình<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Di tích lịch sử</option><option>Lịch sử</option><option>Kiến trúc</option><option>Bảo tàng</option><option>Văn hóa</option></select></label><label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value)}><option>Bản nháp</option><option>Đang hoạt động</option></select></label></div>
      <label>Nội dung thuyết minh <em>*</em><textarea rows="4" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Nhập nội dung để hệ thống dùng cho thuyết minh và tạo audio..." /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
    <div className="modal-foot"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Hủy</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Đang lưu…' : site ? 'Lưu thay đổi' : 'Tạo di tích'} {!saving && <ArrowRight size={15} />}</button></div>
  </form></div>;
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default App;
