const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const defaultApiBaseUrl = import.meta.env.DEV ? '' : defaultApiUrl;
const configuredApiUrl = import.meta.env.VITE_API_URL ?? defaultApiBaseUrl;
export const apiBaseUrl = (configuredApiUrl && !/^https?:\/\//i.test(configuredApiUrl)
  ? `https://${configuredApiUrl}`
  : configuredApiUrl).replace(/\/+$/, '');

const adminTokenStorageKey = 'ditichq1-admin-token';

function withAdminToken(options = {}) {
  const token = sessionStorage.getItem(adminTokenStorageKey);
  if (!token) return options;
  return {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  };
}

async function handleExpiredAdminSession(response) {
  if (response.status === 401 && sessionStorage.getItem(adminTokenStorageKey)) {
    sessionStorage.removeItem(adminTokenStorageKey);
    window.dispatchEvent(new Event('ditichq1-admin-auth-expired'));
  }
}

export async function loginAdmin(username, password) {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    let message = `Đăng nhập thất bại (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new Error(message);
  }
  const session = await response.json();
  if (typeof session.access_token !== 'string' || !session.access_token) {
    throw new Error('Backend trả về phiên đăng nhập không hợp lệ.');
  }
  return session;
}

export async function updateAdminCredentials(currentPassword, username, newPassword) {
  const session = await requestSite('/api/auth/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current_password: currentPassword,
      username,
      new_password: newPassword,
    }),
  }, true);
  if (typeof session.access_token !== 'string' || !session.access_token) {
    throw new Error('Backend trả về phiên đăng nhập không hợp lệ.');
  }
  sessionStorage.setItem(adminTokenStorageKey, session.access_token);
  return session;
}

export async function fetchSites() {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/api/sites/?lang=vi&include_audio=false`);
  } catch {
    throw new Error(`Không kết nối được Backend tại ${apiBaseUrl || 'địa chỉ proxy hiện tại'}.`);
  }

  if (!response.ok) {
    throw new Error(`Backend phản hồi lỗi (${response.status}).`);
  }

  const records = await response.json();
  if (!Array.isArray(records)) {
    throw new Error('Backend trả về dữ liệu di tích không hợp lệ.');
  }

  const colors = ['mint', 'rose', 'gold', 'blue', 'lilac'];
  return records.map((record, index) => ({
    id: record.code || record._id,
    code: record.code,
    name: record.name,
    category: record.category || 'Di tích lịch sử',
    address: record.address || '',
    description: record.description || '',
    lat: record.lat ?? record.location?.coordinates?.[1] ?? '',
    lng: record.lng ?? record.location?.coordinates?.[0] ?? '',
    isActive: record.is_active !== false,
    languages: ['VI'],
    narrations: 1,
    status: record.is_active === false ? 'Bản nháp' : 'Đang hoạt động',
    color: colors[index % colors.length],
    image: record.image_url || '',
  }));
}

async function requestSite(path, options = {}, requiresAdmin = false) {
  let response;
  try {
    response = await fetch(
      `${apiBaseUrl}${path}`,
      requiresAdmin ? withAdminToken(options) : options,
    );
  } catch {
    throw new Error(`Không kết nối được Backend tại ${apiBaseUrl || 'địa chỉ proxy hiện tại'}.`);
  }
  if (requiresAdmin) await handleExpiredAdminSession(response);
  if (!response.ok) {
    let detail = `Backend phản hồi lỗi (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

export async function fetchAdminSites() {
  const records = await requestSite('/api/sites/admin', {}, true);
  if (!Array.isArray(records)) {
    throw new Error('Backend trả về danh sách di tích không hợp lệ.');
  }
  const colors = ['mint', 'rose', 'gold', 'blue', 'lilac'];
  return records.map((record, index) => ({
    id: record.code || record._id,
    code: record.code,
    name: record.name,
    category: record.category || 'Di tích lịch sử',
    address: record.address || '',
    description: record.description || '',
    lat: record.lat ?? record.location?.coordinates?.[1] ?? '',
    lng: record.lng ?? record.location?.coordinates?.[0] ?? '',
    isActive: record.is_active !== false,
    languages: ['VI', 'EN', 'JA', 'ZH'],
    narrations: 4,
    status: record.is_active === false ? 'Bản nháp' : 'Đang hoạt động',
    color: colors[index % colors.length],
    image: record.image_url || '',
  }));
}

export async function fetchRecentActivity() {
  const records = await requestSite('/api/sites/activity', {}, true);
  if (!Array.isArray(records)) {
    throw new Error('Backend trả về lịch sử hoạt động không hợp lệ.');
  }
  return records;
}

export async function fetchGeofenceSettings() {
  const settings = await requestSite('/api/sites/geofence-settings');
  if (!Number.isInteger(settings?.radius_m) || settings.radius_m < 20 || settings.radius_m > 200) {
    throw new Error('Backend trả về bán kính geofence không hợp lệ.');
  }
  return settings;
}

export async function updateGeofenceSettings(radiusM) {
  const settings = await requestSite('/api/sites/geofence-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ radius_m: radiusM }),
  }, true);
  if (!Number.isInteger(settings?.radius_m) || settings.radius_m !== radiusM) {
    throw new Error('Backend không xác nhận bán kính geofence vừa lưu.');
  }
  return settings;
}

function toSitePayload(site) {
  return {
    name: site.name.trim(),
    lat: Number(site.lat),
    lng: Number(site.lng),
    address: site.address.trim(),
    category: site.category,
    description: site.description.trim(),
    is_active: site.status === 'Đang hoạt động',
  };
}

export async function createSite(site) {
  const payload = toSitePayload(site);
  payload.code = site.code.trim();
  return requestSite('/api/sites/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, true);
}

export async function updateSite(code, site) {
  return requestSite(`/api/sites/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSitePayload(site)),
  }, true);
}

export async function deleteSite(code) {
  return requestSite(`/api/sites/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  }, true);
}

export async function fetchActiveListeners() {
  const response = await fetch(
    `${apiBaseUrl}/api/sites/listeners/active`,
    withAdminToken(),
  );
  await handleExpiredAdminSession(response);
  if (!response.ok) {
    throw new Error(`Không tải được số thiết bị đang nghe (${response.status}).`);
  }
  return response.json();
}

export async function heartbeatListener(sessionId, siteCode) {
  const response = await fetch(`${apiBaseUrl}/api/sites/listeners/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, site_code: siteCode }),
  });
  if (!response.ok) {
    throw new Error(`Không đăng ký được phiên nghe (${response.status}).`);
  }
  return response.json();
}

export async function leaveListener(sessionId, keepalive = false) {
  const response = await fetch(
    `${apiBaseUrl}/api/sites/listeners/leave?session_id=${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
      keepalive,
    },
  );
  if (!response.ok) {
    throw new Error(`Không kết thúc được phiên nghe (${response.status}).`);
  }
  return response.json();
}

export async function fetchSiteNarration(siteCode, lang = 'vi') {
  const response = await fetch(
    `${apiBaseUrl}/api/sites/${encodeURIComponent(siteCode)}/narration?lang=${encodeURIComponent(lang)}`,
  );
  if (!response.ok) {
    throw new Error(`Không tải được bài thuyết minh (${response.status}).`);
  }
  return response.json();
}
