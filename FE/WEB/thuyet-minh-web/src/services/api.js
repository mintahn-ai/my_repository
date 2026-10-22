const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const defaultApiBaseUrl = import.meta.env.DEV ? '' : defaultApiUrl;
export const apiBaseUrl = (import.meta.env.VITE_API_URL ?? defaultApiBaseUrl).replace(/\/+$/, '');

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

async function requestSite(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, options);
  } catch {
    throw new Error(`Không kết nối được Backend tại ${apiBaseUrl || 'địa chỉ proxy hiện tại'}.`);
  }
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
  const records = await requestSite('/api/sites/admin');
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
  const records = await requestSite('/api/sites/activity');
  if (!Array.isArray(records)) {
    throw new Error('Backend trả về lịch sử hoạt động không hợp lệ.');
  }
  return records;
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
  });
}

export async function updateSite(code, site) {
  return requestSite(`/api/sites/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSitePayload(site)),
  });
}

export async function deleteSite(code) {
  return requestSite(`/api/sites/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

export async function fetchActiveListeners() {
  const response = await fetch(`${apiBaseUrl}/api/sites/listeners/active`);
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
