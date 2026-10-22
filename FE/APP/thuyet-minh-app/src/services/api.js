import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { sites as sampleSites } from '../data/heritage.js';

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const defaultApiUrl = expoHost
  ? `http://${expoHost}:8000`
  : Platform.OS === 'android'
    ? 'http://10.0.2.2:8000'
    : 'http://localhost:8000';

export const apiBaseUrl = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '');

export function apiLanguageCode(code) {
  return code === 'ZH' ? 'zh-CN' : code.toLowerCase();
}

export async function fetchSiteNarration(siteCode, language) {
  let response;
  try {
    const params = new URLSearchParams({ lang: apiLanguageCode(language) });
    response = await fetch(
      `${apiBaseUrl}/api/sites/${encodeURIComponent(siteCode)}/narration?${params.toString()}`,
    );
  } catch {
    throw new Error(`Không kết nối được BE tại ${apiBaseUrl}. Hãy bật backend và kiểm tra địa chỉ API.`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).detail || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `BE phản hồi lỗi (${response.status}).`);
  }

  return response.json();
}

export function resolveAudioUrl(path) {
  if (!path) return null;
  return new URL(path, `${apiBaseUrl}/`).toString();
}

async function requestSites(path) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`);
  } catch {
    throw new Error(`Không kết nối được BE tại ${apiBaseUrl}. Hãy bật backend và kiểm tra địa chỉ API.`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.detail || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `BE phản hồi lỗi (${response.status}).`);
  }

  const result = await response.json();
  if (!Array.isArray(result)) {
    throw new Error('Dữ liệu BE trả về không đúng định dạng danh sách di tích.');
  }
  return result;
}

export function fetchSites(language) {
  const params = new URLSearchParams({ lang: apiLanguageCode(language) });
  return requestSites(`/api/sites/?${params.toString()}`);
}

export function fetchNearbySites({ latitude, longitude, radius = 500, language }) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
    radius_m: String(radius),
    lang: apiLanguageCode(language),
  });
  return requestSites(`/api/sites/nearby?${params.toString()}`);
}

export async function syncLocation({ latitude, longitude, radius = 30, language }) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/api/sites/sync-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: latitude,
        lng: longitude,
        radius_m: radius,
        lang: apiLanguageCode(language),
      }),
    });
  } catch {
    throw new Error(`Không kết nối được BE tại ${apiBaseUrl}. Hãy bật backend và kiểm tra địa chỉ API.`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.detail || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `BE phản hồi lỗi (${response.status}).`);
  }

  return response.json();
}

function distanceBetweenMeters(latitude, longitude, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return null;
  const [siteLongitude, siteLatitude] = coordinates;
  const radians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDelta = radians(siteLatitude - latitude);
  const longitudeDelta = radians(siteLongitude - longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(siteLatitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

function formatDistance(distance) {
  if (distance === null) return null;
  return distance < 1000
    ? `${distance} m`
    : `${(distance / 1000).toFixed(1).replace('.', ',')} km`;
}

export function adaptSiteRecords(records, origin) {
  return records.map((record) => {
    const template = sampleSites.find((site) => site.slug === record.code || site.name === record.name);
    const coordinates = record.lat != null && record.lng != null
      && Number.isFinite(Number(record.lat)) && Number.isFinite(Number(record.lng))
      ? [Number(record.lng), Number(record.lat)]
      : record.location?.coordinates;
    const distance = origin
      ? distanceBetweenMeters(origin.latitude, origin.longitude, coordinates)
      : null;
    const description = record.translation?.description || record.description || template?.story || '';
    const language = record.translation?.language || 'vi';
    return {
      ...template,
      ...record,
      id: record.code,
      slug: record.code,
      name: record.name,
      category: template?.category || 'Di tích lịch sử',
      address: record.address || template?.address || '',
      distance: formatDistance(distance) || template?.distance || '—',
      duration: template?.duration || '00:00',
      tagline: description.split(/[.!?]\s/, 1)[0] || description,
      story: description,
      image: template?.image || null,
      paint: template?.paint || ['#302824', '#785640', '#D9B184'],
      languages: [language === 'zh-CN' ? 'ZH' : language.toUpperCase()],
      audioUrl: resolveAudioUrl(record.audio_url),
      narrationLanguage: record.translation?.language || null,
      location: coordinates
        ? { type: 'Point', coordinates }
        : record.location,
    };
  });
}
