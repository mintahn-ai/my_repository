import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, ImageBackground, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import {
  ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Compass, Headphones, Heart, Info, Languages, LocateFixed,
  Map, MapPin, MoreHorizontal, Navigation, Pause, Play, QrCode, RotateCcw,
  RotateCw, Search, Settings, Share2, SlidersHorizontal, Sparkles, X,
} from 'lucide-react-native';
import { languages, sites } from './src/data/heritage.js';
import { adaptSiteRecords, apiBaseUrl, fetchGeofenceSettings, fetchNearbySites, fetchSiteNarration, fetchSites, syncLocation } from './src/services/api.js';

const accent = '#F04D2E';
const ink = '#22201F';
const muted = '#98928C';

const tabs = [
  { key: 'home', label: 'Khám phá', icon: Compass },
  { key: 'map', label: 'Bản đồ', icon: Map },
  { key: 'saved', label: 'Đã lưu', icon: Bookmark },
  { key: 'profile', label: 'Cá nhân', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [screen, setScreen] = useState('main');
  const [selectedSite, setSelectedSite] = useState(sites[0]);
  const [siteList, setSiteList] = useState(sites);
  const [language, setLanguage] = useState(languages[0]);
  const [languagePicker, setLanguagePicker] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const audioPlayer = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const playing = audioStatus.playing;
  const elapsed = audioStatus.currentTime || 0;
  const [category, setCategory] = useState('Tất cả');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoPlayRequestedSiteId, setAutoPlayRequestedSiteId] = useState(null);
  const [appIsActive, setAppIsActive] = useState(
    AppState.currentState == null || AppState.currentState === 'active',
  );
  const gpsCheckInFlight = useRef(false);
  const lastGpsCheckAt = useRef(0);
  const lastTriggeredSite = useRef(null);
  const lastGpsErrorAt = useRef(0);
  const geofenceRadiusM = useRef(50);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const filteredSites = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('vi');
    return siteList.filter((site) => {
      const matchesCategory = category === 'Tất cả' || site.category === category;
      const matchesQuery = !q || `${site.name} ${site.address} ${site.category}`.toLocaleLowerCase('vi').includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [category, search, siteList]);

  useEffect(() => {
    let active = true;
    setApiLoading(true);
    setApiError('');
    fetchSites(language.code)
      .then((records) => {
        if (!active) return;
        const remoteSites = adaptSiteRecords(records);
        setSiteList(remoteSites);
        setSelectedSite((current) => remoteSites.find((site) => site.id === current?.id) || remoteSites[0] || null);
      })
      .catch((error) => {
        if (active) setApiError(error.message);
      })
      .finally(() => {
        if (active) setApiLoading(false);
      });
    return () => { active = false; };
  }, [language.code]);

  useEffect(() => {
    if (selectedSite?.audioUrl) audioPlayer.replace(selectedSite.audioUrl);
    else audioPlayer.pause();
    if (selectedSite?.audioUrl && autoPlayRequestedSiteId === selectedSite.id) {
      audioPlayer.play();
      setAutoPlayRequestedSiteId(null);
    }
  }, [audioPlayer, selectedSite?.audioUrl, selectedSite?.id, autoPlayRequestedSiteId]);

  useEffect(() => {
    if (audioStatus.error) showToast('Không thể tải audio từ máy chủ. Hãy kiểm tra kết nối BE.');
  }, [audioStatus.error]);

  useEffect(() => {
    if (screen !== 'detail' || !selectedSite?.slug) return undefined;
    const requestedLanguage = language.code === 'ZH' ? 'zh-CN' : language.code.toLowerCase();
    if (selectedSite.audioUrl && selectedSite.narrationLanguage === requestedLanguage) {
      return undefined;
    }

    let active = true;
    fetchSiteNarration(selectedSite.slug, language.code)
      .then((record) => {
        if (!active) return;
        const [narratedSite] = adaptSiteRecords([record]);
        setSelectedSite(narratedSite);
        setSiteList((current) => current.map((site) => (
          site.id === narratedSite.id ? narratedSite : site
        )));
      })
      .catch((error) => {
        if (active) showToast(error.message);
      });

    return () => { active = false; };
  }, [screen, selectedSite?.slug, selectedSite?.audioUrl, selectedSite?.narrationLanguage, language.code]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 2300);
  };
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!autoPlay || !appIsActive) return undefined;
    let active = true;
    let locationSubscription;

    const checkGeofence = async (coords) => {
      const now = Date.now();
      if (!active || gpsCheckInFlight.current || now - lastGpsCheckAt.current < 8000) return;
      lastGpsCheckAt.current = now;
      gpsCheckInFlight.current = true;
      try {
        const result = await syncLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          radius: geofenceRadiusM.current,
          language: language.code,
        });
        lastGpsErrorAt.current = 0;
        if (!active) return;
        if (!result.trigger || !result.site) {
          lastTriggeredSite.current = null;
          return;
        }
        if (lastTriggeredSite.current === result.site.code) return;

        lastTriggeredSite.current = result.site.code;
        const [triggeredSite] = adaptSiteRecords([result.site], coords);
        setSiteList((current) => current.map((site) => (
          site.id === triggeredSite.id ? triggeredSite : site
        )));
        setSelectedSite(triggeredSite);
        setAutoPlayRequestedSiteId(triggeredSite.id);
        setActiveTab('explore');
        setScreen('detail');
        showToastRef.current(`Đang phát thuyết minh: ${triggeredSite.name}`);
      } catch (error) {
        if (active && Date.now() - lastGpsErrorAt.current > 30000) {
          lastGpsErrorAt.current = Date.now();
          showToastRef.current(`Lỗi kiểm tra vùng GPS: ${error.message}`);
        }
      } finally {
        gpsCheckInFlight.current = false;
      }
    };

    const handleLocationError = (error) => {
      if (!active) return;
      active = false;
      setAutoPlay(false);
      showToastRef.current(`Không thể tiếp tục định vị: ${error.message || 'không có quyền vị trí.'}`);
    };

    const startWatching = async () => {
      const settings = await fetchGeofenceSettings();
      if (!active) return;
      geofenceRadiusM.current = settings.radius_m;
      if (Platform.OS === 'web') {
        if (!navigator.geolocation) {
          handleLocationError(new Error('Trình duyệt không hỗ trợ GPS.'));
          return;
        }
        const watchId = navigator.geolocation.watchPosition(
          ({ coords }) => { void checkGeofence(coords); },
          handleLocationError,
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
        );
        locationSubscription = { remove: () => navigator.geolocation.clearWatch(watchId) };
        return;
      }

      const permissionResult = await Location.getForegroundPermissionsAsync();
      if (!active) return;
      if (permissionResult.status !== 'granted') {
        handleLocationError(new Error('Bật quyền vị trí khi sử dụng ứng dụng.'));
        return;
      }
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 10,
          timeInterval: 8000,
        },
        ({ coords }) => { void checkGeofence(coords); },
      );
      if (!active) subscription.remove();
      else locationSubscription = subscription;
    };

    void startWatching().catch((error) => handleLocationError(error));
    return () => {
      active = false;
      locationSubscription?.remove();
    };
  }, [appIsActive, autoPlay, language.code]);

  const setAutomaticPlayback = async (enabled) => {
    if (!enabled) {
      setAutoPlay(false);
      return;
    }
    if (Platform.OS === 'web') {
      if (!navigator.geolocation) {
        showToast('Trình duyệt này không hỗ trợ định vị GPS.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => setAutoPlay(true),
        (error) => showToast(`Không thể cấp quyền định vị: ${error.message}`),
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }
    try {
      const permissionResult = await Location.requestForegroundPermissionsAsync();
      if (permissionResult.status !== 'granted') {
        showToast('Cần cho phép vị trí khi dùng ứng dụng để tự động phát.');
        return;
      }
      setAutoPlay(true);
    } catch (error) {
      showToast(`Không thể yêu cầu quyền vị trí: ${error.message}`);
    }
  };

  const toggleSaved = (site) => {
    setSavedIds((current) => current.includes(site.id)
      ? current.filter((id) => id !== site.id)
      : [...current, site.id]);
    showToast(savedIds.includes(site.id) ? 'Đã bỏ lưu di tích' : 'Đã lưu vào bộ sưu tập');
  };

  const openDetail = (site) => {
    setSelectedSite(site);
    setScreen('detail');
    audioPlayer.pause();
  };

  const selectTab = (key) => {
    setActiveTab(key);
    setScreen('main');
    audioPlayer.pause();
  };

  const onQRScanned = ({ data }) => {
    const match = siteList.find((site) => site.slug && data.toLowerCase().includes(site.slug));
    if (match) {
      setSelectedSite(match);
      setScreen('detail');
    }
    showToast(match ? `Đã nhận diện ${match.name}` : 'Mã QR chưa có trong danh mục');
  };

  const playSelectedAudio = () => {
    if (!selectedSite?.audioUrl) {
      showToast('Di tích này chưa có audio từ máy chủ.');
      return;
    }
    if (playing) audioPlayer.pause();
    else audioPlayer.play();
  };

  const seekSelectedAudio = (amount) => {
    const duration = audioStatus.duration || durationSeconds(selectedSite?.duration || '00:00');
    void audioPlayer.seekTo(Math.max(0, Math.min(duration, elapsed + amount)));
  };

  const findNearby = async () => {
    try {
      let location;
      if (Platform.OS === 'web') {
        location = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Trình duyệt này không hỗ trợ định vị.'));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (position) => resolve(position.coords),
            () => reject(new Error('Chưa cấp quyền vị trí. Hãy bật quyền định vị rồi thử lại.')),
            { enableHighAccuracy: true, timeout: 10000 },
          );
        });
      } else {
        const permissionResult = await Location.requestForegroundPermissionsAsync();
        if (permissionResult.status !== 'granted') {
          throw new Error('Ứng dụng cần quyền vị trí để tìm di tích gần bạn.');
        }
        location = await Location.getCurrentPositionAsync({});
        location = location.coords;
      }
      setApiLoading(true);
      const records = await fetchNearbySites({
        latitude: location.latitude,
        longitude: location.longitude,
        language: language.code,
      });
      const geofence = await syncLocation({
        latitude: location.latitude,
        longitude: location.longitude,
        language: language.code,
      });
      const nearbySites = adaptSiteRecords(records, location);
      setSiteList(nearbySites);
      setSelectedSite((current) => nearbySites.find((site) => site.id === current?.id) || nearbySites[0] || null);
      setApiError('');
      setActiveTab('explore');
      setScreen('main');
      if (autoPlay && geofence.trigger && geofence.site) {
        const triggeredSite = adaptSiteRecords([geofence.site], location)[0];
        setSelectedSite(triggeredSite);
        setAutoPlayRequestedSiteId(triggeredSite.id);
        setScreen('detail');
        showToast(`Đang phát thuyết minh: ${triggeredSite.name}`);
      }
      if (!nearbySites.length) showToast('Chưa có di tích nào trong bán kính 500 m.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setApiLoading(false);
    }
  };

  const retryFetchSites = () => {
    setApiLoading(true);
    setApiError('');
    fetchSites(language.code)
      .then((records) => {
        const remoteSites = adaptSiteRecords(records);
        setSiteList(remoteSites);
        setSelectedSite((current) => remoteSites.find((site) => site.id === current?.id) || remoteSites[0] || null);
      })
      .catch((error) => setApiError(error.message))
      .finally(() => setApiLoading(false));
  };

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ExpoStatusBar style={screen === 'detail' ? 'light' : 'dark'} />
      {!!(apiLoading || apiError) && <ApiStatusBanner loading={apiLoading} error={apiError} apiUrl={apiBaseUrl} onRetry={retryFetchSites} />}
      {screen === 'detail' && selectedSite ? (
        <DetailScreen
          site={selectedSite}
          sites={siteList}
          language={language}
          playing={playing}
          elapsed={elapsed}
          duration={audioStatus.duration || durationSeconds(selectedSite?.duration || '00:00')}
          isSaved={savedIds.includes(selectedSite.id)}
          onBack={() => { setScreen('main'); audioPlayer.pause(); }}
          onPlay={playSelectedAudio}
          onSeek={seekSelectedAudio}
          onSave={() => toggleSaved(selectedSite)}
          onLanguage={() => setLanguagePicker(true)}
          onOpenSite={openDetail}
        />
      ) : screen === 'scanner' ? (
        <ScannerScreen
          permission={permission}
          requestPermission={requestPermission}
          onBack={() => setScreen('main')}
          onScanned={onQRScanned}
          onManual={() => siteList[0] && openDetail(siteList[0])}
        />
      ) : (
        <>
          {activeTab === 'home' && (
            <HomeScreen
              language={language}
              sites={siteList}
              savedIds={savedIds}
              onLanguage={() => setLanguagePicker(true)}
              onSearch={() => { setActiveTab('explore'); setScreen('main'); }}
              onScan={() => setScreen('scanner')}
              onOpenSite={openDetail}
              onSave={toggleSaved}
              onMap={() => selectTab('map')}
              onSeeAll={() => selectTab('explore')}
              onNearby={findNearby}
            />
          )}
          {activeTab === 'explore' && (
            <ExploreScreen
              language={language}
              search={search}
              setSearch={setSearch}
              category={category}
              setCategory={setCategory}
              sites={filteredSites}
              savedIds={savedIds}
              onLanguage={() => setLanguagePicker(true)}
              onOpenSite={openDetail}
              onSave={toggleSaved}
              onScan={() => setScreen('scanner')}
            />
          )}
          {activeTab === 'map' && (
            <MapScreen
              language={language}
              sites={siteList}
              onLanguage={() => setLanguagePicker(true)}
              onOpenSite={openDetail}
              onScan={() => setScreen('scanner')}
            />
          )}
          {activeTab === 'saved' && (
            <SavedScreen
              language={language}
              savedSites={siteList.filter((site) => savedIds.includes(site.id))}
              onLanguage={() => setLanguagePicker(true)}
              onOpenSite={openDetail}
              onSave={toggleSaved}
              onExplore={() => selectTab('explore')}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileScreen
              language={language}
              autoPlay={autoPlay}
              savedCount={savedIds.length}
              setAutoPlay={setAutomaticPlayback}
              onLanguage={() => setLanguagePicker(true)}
              onScan={() => setScreen('scanner')}
              onNotify={showToast}
            />
          )}
          <BottomTabs activeTab={activeTab} onChange={selectTab} />
        </>
      )}

      <LanguagePicker
        visible={languagePicker}
        selected={language}
        onClose={() => setLanguagePicker(false)}
        onSelect={(item) => { setLanguage(item); setLanguagePicker(false); showToast(`Đã đổi sang ${item.name}`); }}
      />
      {!!toast && <View style={styles.toast}><Check size={15} color="#fff" /><Text style={styles.toastText}>{toast}</Text></View>}
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AppHeader({ language, onLanguage, title, subtitle, dark = false, onScan }) {
  return (
    <View style={[styles.appHeader, dark && styles.headerOnDark]}>
      <View style={styles.headerTitles}>
        {title ? <Text style={[styles.headerTitle, dark && styles.textWhite]}>{title}</Text> : (
          <View style={styles.wordmarkRow}>
            <View style={styles.wordmarkIcon}><MapPin size={15} color="#fff" fill="#fff" /></View>
            <Text style={[styles.wordmark, dark && styles.textWhite]}>DI TÍCH <Text style={styles.wordmarkAccent}>Q1</Text></Text>
          </View>
        )}
        {!!subtitle && <Text style={[styles.headerSubtitle, dark && styles.headerSubtitleDark]}>{subtitle}</Text>}
      </View>
      <View style={styles.headerActions}>
        {onScan && <Pressable style={[styles.roundButton, dark && styles.roundButtonDark]} onPress={onScan} accessibilityLabel="Quét mã QR"><QrCode size={18} color={dark ? '#fff' : ink} /></Pressable>}
        <Pressable style={[styles.languageButton, dark && styles.languageButtonDark]} onPress={onLanguage}>
          <Text style={styles.languageFlag}>{language.flag}</Text><Text style={[styles.languageCode, dark && styles.textWhite]}>{language.code}</Text><ChevronDown size={12} color={dark ? '#fff' : ink} />
        </Pressable>
      </View>
    </View>
  );
}

function ApiStatusBanner({ loading, error, apiUrl, onRetry }) {
  return (
    <View style={[styles.apiStatusBanner, !!error && styles.apiStatusError]}>
      <View style={styles.apiStatusCopy}>
        {loading && <ActivityIndicator size="small" color={error ? '#fff' : accent} />}
        <Text style={styles.apiStatusText} numberOfLines={2}>
          {loading ? `Đang tải dữ liệu từ BE (${apiUrl})...` : error}
        </Text>
      </View>
      {!!error && <Pressable onPress={onRetry} style={styles.apiRetryButton}><Text style={styles.apiRetryText}>Thử lại</Text></Pressable>}
    </View>
  );
}

function HomeScreen({ language, sites: siteList, savedIds, onLanguage, onSearch, onScan, onOpenSite, onSave, onMap, onSeeAll, onNearby }) {
  const [slide, setSlide] = useState(0);
  const [carouselWidth, setCarouselWidth] = useState(0);
  const carouselRef = useRef(null);
  const carouselDrag = useMouseDragScroll();
  const nearbyDrag = useMouseDragScroll();
  const featured = siteList.slice(0, 3);

  useEffect(() => {
    if (!carouselWidth || !featured.length) return undefined;
    const timer = setInterval(() => {
      const nextSlide = (slide + 1) % featured.length;
      setSlide(nextSlide);
      carouselRef.current?.scrollTo({ x: nextSlide * carouselWidth, animated: true });
    }, 3000);

    return () => clearInterval(timer);
  }, [carouselWidth, featured.length, slide]);

  const onSwipeEnd = (event) => {
    if (!carouselWidth) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / carouselWidth);
    setSlide(next);
  };
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={Platform.OS === 'web'}>
      <AppHeader language={language} onLanguage={onLanguage} onScan={onScan} />
      <View style={styles.homeGreeting}>
        <View><Text style={styles.greetingKicker}>{todayLabel()}</Text><Text style={styles.greetingTitle}>Chào buổi sáng <Text style={styles.wave}>☀️</Text></Text><Text style={styles.greetingSub}>Hôm nay mình cùng khám phá nhé.</Text></View>
        <Pressable style={styles.avatarButton} onPress={() => {}}><Text style={styles.avatarInitial}>Q1</Text><View style={styles.onlineDot} /></Pressable>
      </View>
      <Pressable style={styles.searchLauncher} onPress={onSearch}>
        <Search size={18} color="#99928D" /><Text style={styles.searchPlaceholder}>Bạn muốn khám phá nơi nào?</Text><View style={styles.searchTuning}><SlidersHorizontal size={15} color="#736E69" /></View>
      </Pressable>

      <View style={styles.sectionHeading}>
        <View><View style={styles.sectionEyebrow}><Sparkles size={12} color={accent} /><Text style={styles.sectionEyebrowText}>CHẠM VÀO LỊCH SỬ</Text></View><Text style={styles.sectionTitle}>Dạo quanh Quận 1</Text></View>
        <Pressable onPress={onSeeAll} style={styles.seeAll}><Text style={styles.seeAllText}>Tất cả</Text><ArrowRight size={14} color={accent} /></Pressable>
      </View>
      {!!featured.length && <View
        style={styles.featuredCarouselViewport}
        onLayout={(event) => {
          const nextWidth = event.nativeEvent.layout.width;
          setCarouselWidth((current) => current === nextWidth ? current : nextWidth);
        }}
      >
        <ScrollView
          ref={carouselRef}
          {...carouselDrag}
          style={styles.featuredCarouselScroll}
          horizontal
          pagingEnabled
          snapToInterval={carouselWidth || undefined}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.heroCarousel}
          onMomentumScrollEnd={onSwipeEnd}
        >
          {featured.map((site, index) => (
            <FeaturedCard
              key={site.id}
              site={site}
              index={index}
              width={carouselWidth}
              saved={savedIds.includes(site.id)}
              onOpen={() => onOpenSite(site)}
              onSave={() => onSave(site)}
            />
          ))}
        </ScrollView>
      </View>}
      {!!featured.length && <View style={styles.carouselMeta}>
        <View style={styles.carouselDots}>{featured.map((item, index) => <View key={item.id} style={[styles.carouselDot, slide === index && styles.carouselDotActive]} />)}</View>
        <Text style={styles.carouselCounter}>0{slide + 1}<Text style={styles.counterMuted}> / 0{featured.length}</Text></Text>
      </View>}
      {!featured.length && <View style={styles.noSitesCard}><Text style={styles.noSitesText}>Chưa có di tích phù hợp trong dữ liệu từ BE.</Text></View>}

      <View style={styles.quickActions}>
        <QuickAction icon={QrCode} label="Quét QR" tone="orange" onPress={onScan} />
        <QuickAction icon={Map} label="Bản đồ" tone="blue" onPress={onMap} />
        <QuickAction icon={Headphones} label="Đang gần bạn" tone="green" onPress={onNearby} />
      </View>

      <View style={styles.sectionHeading}>
        <View><Text style={styles.sectionTitle}>Điểm đến quanh bạn</Text><Text style={styles.sectionSub}>Những câu chuyện chỉ cách bạn vài bước chân</Text></View>
        <Pressable style={styles.textOnlyLink} onPress={onSeeAll}><Text style={styles.seeAllText}>Xem thêm</Text></Pressable>
      </View>
      <ScrollView {...nearbyDrag} horizontal showsHorizontalScrollIndicator={false} onWheel={Platform.OS === 'web' ? scrollHorizontallyWithWheel : undefined} contentContainerStyle={styles.horizontalCards}>
        {siteList.slice(1, 5).map((site) => <MiniPlaceCard key={site.id} site={site} onPress={() => onOpenSite(site)} />)}
      </ScrollView>

      <View style={styles.nearbyBanner}>
        <LinearGradient colors={['#252521', '#3D352E', '#644C39']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.nearbyBannerCopy}><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.livePillText}>THUYẾT MINH TỰ ĐỘNG</Text></View><Text style={styles.nearbyCopy}>Bật vị trí để tìm di tích gần nhất.</Text><Pressable style={styles.nearbyButton} onPress={onNearby}><LocateFixed size={14} color="#fff" /><Text style={styles.nearbyButtonText}>Tìm quanh đây</Text></Pressable></View>
        <View style={styles.nearbyIllustration}><View style={styles.glowCircle} /><BuildingIllustration color="#C9A37B" /></View>
      </View>
      <View style={styles.homeFooter}><ShieldMark /><Text>Khám phá di sản · Lắng nghe câu chuyện</Text></View>
    </ScrollView>
  );
}

function FeaturedCard({ site, index, width, saved, onOpen, onSave }) {
  const palettes = [['#312723', '#91654B', '#E2B78B'], ['#243135', '#617A70', '#B6C1A7'], ['#32302B', '#88735D', '#D3B58F']];
  const colors = palettes[index % palettes.length];
  return (
    <Pressable onPress={onOpen} style={[styles.featuredCard, { width }]}>
      <ImageBackground source={site.image ? { uri: site.image } : null} resizeMode="cover" style={StyleSheet.absoluteFill} imageStyle={styles.featuredImage}>
        <LinearGradient colors={['#15141218', '#17151400', '#151412E8']} locations={[0, 0.36, 1]} style={StyleSheet.absoluteFill} />
      </ImageBackground>
      <View style={styles.photoTint}><LinearGradient colors={[`${colors[0]}88`, `${colors[1]}66`, `${colors[2]}22`]} style={StyleSheet.absoluteFill} /><BuildingIllustration color={colors[2]} large /></View>
      <View style={styles.featuredTop}><View style={styles.featuredTag}><Sparkles size={11} color="#fff" /><Text style={styles.featuredTagText}>GỢI Ý HÔM NAY</Text></View><Pressable style={styles.favoriteButton} onPress={(event) => { event.stopPropagation(); onSave(); }}><Heart size={17} color="#fff" fill={saved ? '#F04D2E' : 'transparent'} /></Pressable></View>
      <View style={styles.featuredBottom}>
        <View style={styles.distancePill}><Navigation size={11} color="#fff" /><Text style={styles.distancePillText}>{site.distance}</Text><Text style={styles.distanceDivider}>·</Text><Text style={styles.distancePillText}>{site.category}</Text></View>
        <Text numberOfLines={1} style={styles.featuredTitle}>{site.name}</Text>
        <Text numberOfLines={1} style={styles.featuredDescription}>{site.tagline}</Text>
        <View style={styles.featuredActions}><Pressable style={styles.featuredListen} onPress={onOpen}><Play size={13} color="#fff" fill="#fff" /><Text style={styles.featuredListenText}>Nghe thuyết minh</Text></Pressable><View style={styles.featuredDuration}><Clock3 size={12} color="#fff" /><Text style={styles.featuredDurationText}>{site.duration}</Text></View><View style={styles.featuredArrow}><ArrowRight size={17} color="#fff" /></View></View>
      </View>
    </Pressable>
  );
}

function BuildingIllustration({ color = '#C9A37B', large = false }) {
  return (
    <View style={[styles.buildingArt, large && styles.buildingArtLarge]} pointerEvents="none">
      <View style={[styles.artDome, { borderColor: color }]} />
      <View style={[styles.artRoof, { backgroundColor: color }]} />
      <View style={[styles.artFacade, { borderColor: `${color}AA` }]}>
        {[0, 1, 2, 3, 4].map((item) => <View key={item} style={[styles.artColumn, { backgroundColor: `${color}B0` }]}><View style={styles.artWindow} /></View>)}
      </View>
      <View style={[styles.artBase, { backgroundColor: color }]} />
    </View>
  );
}

function QuickAction({ icon: Icon, label, tone, onPress }) {
  return <Pressable style={styles.quickAction} onPress={onPress}><View style={[styles.quickIcon, styles[`quickIcon_${tone}`]]}><Icon size={18} color={styles[`quickColor_${tone}`].color} /></View><Text style={styles.quickLabel}>{label}</Text></Pressable>;
}

function MiniPlaceCard({ site, onPress }) {
  return <Pressable style={styles.miniPlaceCard} onPress={onPress}><View style={[styles.miniArtwork, { backgroundColor: site.paint[0] }]}><LinearGradient colors={site.paint} style={StyleSheet.absoluteFill} /><BuildingIllustration color={site.paint[2]} /><View style={styles.miniDistance}><Navigation size={9} color="#fff" /><Text style={styles.miniDistanceText}>{site.distance}</Text></View></View><View style={styles.miniPlaceInfo}><Text numberOfLines={1} style={styles.miniPlaceTitle}>{site.name}</Text><Text style={styles.miniPlaceCategory}>{site.category}</Text><View style={styles.miniAudio}><Headphones size={11} color={accent} /><Text>{site.duration} thuyết minh</Text></View></View></Pressable>;
}

function ExploreScreen({ language, search, setSearch, category, setCategory, sites: list, savedIds, onLanguage, onOpenSite, onSave, onScan }) {
  const categoryDrag = useMouseDragScroll();
  const categories = ['Tất cả', 'Lịch sử', 'Kiến trúc', 'Bảo tàng', 'Văn hóa'];
  return <View style={styles.fill}>
    <AppHeader language={language} onLanguage={onLanguage} onScan={onScan} title="Khám phá" subtitle="Mỗi góc phố, một câu chuyện." />
    <View style={styles.exploreSearch}><Search size={17} color={muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Tìm di tích, đường phố..." placeholderTextColor="#aaa39d" style={styles.exploreInput} returnKeyType="search" /><Pressable style={styles.filterButton} onPress={() => setCategory(category === 'Tất cả' ? 'Lịch sử' : 'Tất cả')}><SlidersHorizontal size={17} color={ink} /></Pressable></View>
    <ScrollView {...categoryDrag} horizontal showsHorizontalScrollIndicator={false} onWheel={Platform.OS === 'web' ? scrollHorizontallyWithWheel : undefined} contentContainerStyle={styles.categoryChips}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.categoryChip, category === item && styles.categoryChipActive]}><Text style={[styles.categoryChipText, category === item && styles.categoryChipTextActive]}>{item}</Text></Pressable>)}</ScrollView>
    <View style={styles.exploreResults}><Text style={styles.resultCount}>{list.length} ĐIỂM THAM QUAN</Text><View style={styles.nearbyStatus}><View style={styles.liveDotSmall} /><Text>GẦN BẠN</Text></View></View>
    <ScrollView style={styles.exploreList} contentContainerStyle={styles.exploreListContent} showsVerticalScrollIndicator={Platform.OS === 'web'}>
      {list.map((site, index) => <ExploreCard key={site.id} site={site} index={index} saved={savedIds.includes(site.id)} onPress={() => onOpenSite(site)} onSave={() => onSave(site)} />)}
      {!list.length && <View style={styles.emptyState}><Search size={26} color="#c1bbb5" /><Text style={styles.emptyTitle}>Chưa tìm thấy di tích</Text><Text style={styles.emptyCopy}>Thử một từ khóa khác hoặc chọn danh mục khác.</Text></View>}
    </ScrollView>
  </View>;
}

function ExploreCard({ site, index, saved, onPress, onSave }) {
  return <Pressable onPress={onPress} style={styles.exploreCard}><View style={[styles.exploreArtwork, { backgroundColor: site.paint[0] }]}><LinearGradient colors={site.paint} style={StyleSheet.absoluteFill} /><BuildingIllustration color={site.paint[2]} /><Text style={styles.artNumber}>0{index + 1}</Text></View><View style={styles.exploreCardInfo}><View style={styles.exploreCardTop}><Text style={styles.exploreCategory}>{site.category}</Text><Pressable hitSlop={12} onPress={(event) => { event.stopPropagation(); onSave(); }}><Heart size={17} color={saved ? accent : '#aaa39d'} fill={saved ? accent : 'transparent'} /></Pressable></View><Text numberOfLines={1} style={styles.explorePlaceName}>{site.name}</Text><View style={styles.exploreAddress}><MapPin size={11} color={muted} /><Text numberOfLines={1} style={styles.exploreAddressText}>{site.address}</Text><Text style={styles.dotSep}>·</Text><Text style={styles.exploreDistance}>{site.distance}</Text></View><View style={styles.exploreCardBottom}><View style={styles.langFlags}>{site.languages.slice(0, 3).map((code) => <Text key={code} style={styles.langFlag}>{languages.find((item) => item.code === code)?.flag}</Text>)}</View><View style={styles.exploreDuration}><Headphones size={11} color={accent} /><Text>{site.duration}</Text></View><ChevronRight size={16} color="#B1AAA4" /></View></View></Pressable>;
}

function DetailScreen({ site, sites: siteList, language, playing, elapsed, duration, isSaved, onBack, onPlay, onSeek, onSave, onLanguage, onOpenSite }) {
  const recommendationsDrag = useMouseDragScroll();
  const progress = `${Math.min(100, duration ? (elapsed / duration) * 100 : 0)}%`;
  return <View style={styles.detailRoot}>
    <ScrollView showsVerticalScrollIndicator={Platform.OS === 'web'} contentContainerStyle={styles.detailScroll}>
      <View style={[styles.detailHero, { backgroundColor: site.paint[0] }]}>
        <ImageBackground source={{ uri: site.image }} style={StyleSheet.absoluteFill} imageStyle={styles.detailImage}>
          <LinearGradient colors={[`${site.paint[0]}55`, `${site.paint[1]}75`, `${site.paint[0]}F0`]} style={StyleSheet.absoluteFill} />
        </ImageBackground>
        <View style={styles.detailTopBar}><Pressable style={styles.detailRound} onPress={onBack}><ArrowLeft size={19} color="#fff" /></Pressable><View style={styles.detailTopActions}><Pressable style={styles.detailRound} onPress={onSave}><Bookmark size={17} color="#fff" fill={isSaved ? '#fff' : 'transparent'} /></Pressable><Pressable style={styles.detailRound} onPress={() => {}}><MoreHorizontal size={19} color="#fff" /></Pressable></View></View>
        <View style={styles.detailHeroBottom}><View style={styles.featuredTag}><Sparkles size={11} color="#fff" /><Text style={styles.detailHeroCategoryText}>{site.category.toUpperCase()}</Text></View><Text style={styles.detailHeroTitle}>{site.name}</Text><View style={styles.detailHeroAddress}><MapPin size={13} color="#eee" /><Text style={styles.detailHeroAddressText}>{site.address} · {site.distance}</Text></View></View>
      </View>
      <View style={styles.detailContent}>
        <View style={styles.detailAudioCard}>
          <View style={styles.audioCardTop}><View style={styles.audioLangRow}><View style={styles.audioLangIcon}><Text>{language.flag}</Text></View><View><Text style={styles.audioLangName}>{language.name}</Text><Text style={styles.audioVoice}>Giọng đọc · Nữ miền Nam</Text></View></View><Pressable style={styles.audioChangeLang} onPress={onLanguage}><Languages size={15} color="#756E68" /><ChevronDown size={12} color="#756E68" /></Pressable></View>
          <View style={styles.audioTrack}><View style={styles.audioTimeRow}><Text>{formatDuration(elapsed)}</Text><Text>{duration ? formatDuration(duration) : site.duration}</Text></View><View style={styles.audioProgress}><View style={[styles.audioProgressFill, { width: progress }]} /><View style={[styles.audioKnob, { left: progress }]} /></View></View>
          <View style={styles.audioControlRow}><Pressable style={styles.skipButton} onPress={() => onSeek(-15)} accessibilityLabel="Lùi 15 giây"><RotateCcw size={15} color="#77716A" /></Pressable><Pressable style={styles.largePlay} onPress={onPlay}>{playing ? <Pause size={20} color="#fff" fill="#fff" /> : <Play size={20} color="#fff" fill="#fff" />}</Pressable><Pressable style={styles.skipButton} onPress={() => onSeek(15)} accessibilityLabel="Tiến 15 giây"><RotateCw size={15} color="#77716A" /></Pressable><View style={styles.speedPill}><Text>1x</Text></View></View>
        </View>
        <View style={styles.detailStoryHeader}><View><Text style={styles.storyEyebrow}>CÂU CHUYỆN DI SẢN</Text><Text style={styles.storyTitle}>Lắng nghe lịch sử</Text></View><Pressable style={styles.shareButton} onPress={() => {}}><Share2 size={16} color="#6E6964" /></Pressable></View>
        <Text style={styles.storyText}>{site.story}</Text>
        <View style={styles.factStrip}><View style={styles.factIcon}><Clock3 size={16} color={accent} /></View><View style={styles.factCopy}><Text style={styles.factLabel}>THỜI GIAN THAM QUAN</Text><Text style={styles.factValue}>Khoảng 15 – 30 phút</Text></View><ChevronRight size={16} color="#a7a09a" /></View>
        <View style={styles.locationCard}><View style={styles.locationMapArt}><View style={styles.mapStreetLine} /><View style={styles.mapBlockA} /><View style={styles.mapBlockB} /><View style={styles.locationPin}><MapPin size={17} color="#fff" fill={accent} /></View></View><View style={styles.locationText}><View><Text style={styles.storyEyebrow}>VỊ TRÍ DI TÍCH</Text><Text style={styles.locationAddress}>{site.address}</Text><Text style={styles.locationDistrict}>Quận 1, TP. Hồ Chí Minh</Text></View><Pressable style={styles.navigateButton} onPress={() => {}}><Navigation size={15} color="#fff" /></Pressable></View></View>
        <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>Nghe tiếp hành trình</Text><Text style={styles.sectionSub}>Những điểm gần đây</Text></View></View>
        <ScrollView {...recommendationsDrag} horizontal showsHorizontalScrollIndicator={false} onWheel={Platform.OS === 'web' ? scrollHorizontallyWithWheel : undefined} contentContainerStyle={styles.horizontalCards}>{siteList.filter((item) => item.id !== site.id).slice(0, 4).map((item) => <MiniPlaceCard key={item.id} site={item} onPress={() => onOpenSite(item)} />)}</ScrollView>
        <View style={{ height: 20 }} />
      </View>
    </ScrollView>
    <View style={styles.detailSticky}><View style={styles.stickyStatus}><View style={styles.liveDotSmall} /><Text>{playing ? `ĐANG PHÁT · ${formatDuration(elapsed)}` : 'THUYẾT MINH ĐANG SẴN SÀNG'}</Text></View><Pressable style={styles.stickyPlay} onPress={onPlay}>{playing ? <Pause size={16} color="#fff" fill="#fff" /> : <Play size={16} color="#fff" fill="#fff" />}<Text>{playing ? 'Tạm dừng' : 'Bắt đầu nghe'}</Text><ArrowRight size={16} color="#fff" /></Pressable></View>
  </View>;
}

function MapScreen({ language, sites: siteList, onLanguage, onOpenSite, onScan }) {
  const [selected, setSelected] = useState(siteList[0] || null);
  const sitesDrag = useMouseDragScroll();
  useEffect(() => {
    setSelected((current) => siteList.find((site) => site.id === current?.id) || siteList[0] || null);
  }, [siteList]);
  return <View style={styles.mapScreen}>
    <View style={styles.mapCanvas}>
      <View style={styles.mapTileOne} /><View style={styles.mapTileTwo} /><View style={styles.mapTileThree} /><View style={styles.mapTileFour} /><View style={styles.mapTileFive} />
      <View style={styles.mapRoadMain} /><View style={styles.mapRoadVertical} /><View style={styles.mapRoadDiagonal} /><View style={styles.mapPark}><Text>CÔNG VIÊN{'\n'}30/4</Text></View><View style={styles.mapWater}><Text>SÔNG SÀI GÒN</Text></View>
      <Text style={[styles.mapStreet, { top: '29%', left: '34%' }]}>ĐỒNG KHỞI</Text><Text style={[styles.mapStreet, { top: '67%', left: '25%' }]}>LÊ LỢI</Text><Text style={[styles.mapStreet, { top: '44%', left: '3%' }]}>NAM KỲ KHỞI NGHĨA</Text>
      {siteList.map((site, index) => <Pressable key={site.id} onPress={() => setSelected(site)} style={[styles.mapPoiPin, styles[`mapPin${index + 1}`], selected?.id === site.id && styles.mapPoiPinSelected]}><MapPin size={17} color="#fff" fill={selected?.id === site.id ? '#F04D2E' : '#78927B'} /></Pressable>)}
      <View style={styles.mapTopBar}><Pressable style={styles.mapLocationButton} onPress={() => {}}><LocateFixed size={17} color={accent} /><View><Text style={styles.mapLocationTitle}>Quận 1</Text><Text style={styles.mapLocationSub}>TP. Hồ Chí Minh</Text></View><ChevronDown size={15} color="#77716A" /></Pressable><AppHeader language={language} onLanguage={onLanguage} onScan={onScan} /></View>
      <Pressable style={styles.mapRecenter} onPress={() => {}}><LocateFixed size={19} color="#514B46" /></Pressable>
      <View style={styles.mapZoom}><Pressable><Text>＋</Text></Pressable><View /><Pressable><Text>−</Text></Pressable></View>
      <View style={styles.mapBottom}><View style={styles.mapBottomHandle} /><View style={styles.mapResultHead}><View><Text style={styles.mapResultEyebrow}>ĐIỂM THAM QUAN GẦN ĐÂY</Text><Text style={styles.mapResultTitle}>Đang quanh bạn <Text style={styles.resultCountMuted}>· {siteList.length} điểm</Text></Text></View><Pressable style={styles.mapFilterButton} onPress={() => {}}><SlidersHorizontal size={16} color="#6c655f" /></Pressable></View>
        {selected ? <Pressable style={styles.mapSelectedCard} onPress={() => onOpenSite(selected)}><View style={[styles.mapSelectedArtwork, { backgroundColor: selected.paint[0] }]}><LinearGradient colors={selected.paint} style={StyleSheet.absoluteFill} /><BuildingIllustration color={selected.paint[2]} /></View><View style={styles.mapSelectedCopy}><View style={styles.nearbyLine}><View style={styles.liveDotSmall} /><Text>{selected.distance} · ĐANG MỞ CỬA</Text></View><Text numberOfLines={1} style={styles.mapSelectedTitle}>{selected.name}</Text><Text style={styles.mapSelectedAddress}>{selected.address}</Text><View style={styles.mapSelectedAction}><Headphones size={13} color="#fff" /><Text>Nghe thuyết minh</Text></View></View><ChevronRight size={17} color="#aaa39d" /></Pressable> : <Text style={styles.noSitesText}>Chưa có di tích trong dữ liệu từ BE.</Text>}
        <ScrollView {...sitesDrag} horizontal showsHorizontalScrollIndicator={false} onWheel={Platform.OS === 'web' ? scrollHorizontallyWithWheel : undefined} contentContainerStyle={styles.mapThumbs}>{siteList.map((site) => <Pressable key={site.id} onPress={() => setSelected(site)} style={[styles.mapThumb, selected?.id === site.id && styles.mapThumbSelected]}><Text>{site.name}</Text></Pressable>)}</ScrollView>
      </View>
    </View>
  </View>;
}

function SavedScreen({ language, savedSites, onLanguage, onOpenSite, onSave, onExplore }) {
  return <View style={styles.fill}><AppHeader language={language} onLanguage={onLanguage} title="Đã lưu" subtitle="Những nơi bạn muốn ghé thăm." /><ScrollView contentContainerStyle={styles.savedContent} showsVerticalScrollIndicator={Platform.OS === 'web'}>
    <View style={styles.savedBanner}><LinearGradient colors={['#332E29', '#74604C', '#C39B73']} style={StyleSheet.absoluteFill} /><View><Text style={styles.savedBannerKicker}>BỘ SƯU TẬP CỦA BẠN</Text><Text style={styles.savedBannerTitle}>{savedSites.length} câu chuyện{'\n'}đang đợi bạn.</Text></View><Bookmark size={36} color="#fff" /></View>
    {!!savedSites.length ? savedSites.map((site, index) => <ExploreCard key={site.id} site={site} index={index} saved onPress={() => onOpenSite(site)} onSave={() => onSave(site)} />) : <View style={styles.emptyState}><Bookmark size={28} color="#c1bbb5" /><Text style={styles.emptyTitle}>Chưa có di tích nào được lưu</Text><Text style={styles.emptyCopy}>Lưu những địa điểm bạn muốn khám phá sau.</Text><Pressable style={styles.emptyButton} onPress={onExplore}><Text>Khám phá di tích</Text><ArrowRight size={14} color="#fff" /></Pressable></View>}
  </ScrollView></View>;
}

function ProfileScreen({ language, autoPlay, savedCount, setAutoPlay, onLanguage, onScan, onNotify }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.profileContent} showsVerticalScrollIndicator={Platform.OS === 'web'}>
    <AppHeader language={language} onLanguage={onLanguage} title="Cá nhân" subtitle="Không gian khám phá của bạn." />
    <View style={styles.profileHero}><LinearGradient colors={['#F8EBDF', '#F5D7C4', '#E8BA9D']} style={StyleSheet.absoluteFill} /><View style={styles.profileAvatarLarge}><Text>Q1</Text><View style={styles.onlineDot} /></View><Text style={styles.profileName}>Người khám phá</Text><Text style={styles.profileSince}>Thành viên từ tháng 10, 2026</Text><View style={styles.profileStats}><View><Text>08</Text><Text>ĐIỂM ĐÃ NGHE</Text></View><View style={styles.profileStatDivider} /><View><Text>{String(savedCount).padStart(2, '0')}</Text><Text>ĐÃ LƯU</Text></View><View style={styles.profileStatDivider} /><View><Text>03</Text><Text>NGÀY KHÁM PHÁ</Text></View></View></View>
    <Text style={styles.profileGroupLabel}>TRẢI NGHIỆM</Text>
    <View style={styles.settingsGroup}>
      <ProfileRow icon={Languages} title="Ngôn ngữ thuyết minh" subtitle={language.name} onPress={onLanguage} />
      <View style={styles.profileSettingRow}><View style={styles.profileRowIcon}><Headphones size={17} color="#4C9C7E" /></View><View style={styles.profileRowCopy}><Text style={styles.profileRowTitle}>Tự động phát gần di tích</Text><Text style={styles.profileRowSub}>Dùng GPS khi mở ứng dụng theo bán kính do quản trị viên cài đặt</Text></View><Switch value={autoPlay} onValueChange={setAutoPlay} trackColor={{ false: '#ddd8d2', true: '#F04D2E' }} thumbColor="#fff" /></View>
      <ProfileRow icon={QrCode} title="Quét mã QR" subtitle="Nghe thuyết minh tại chỗ" onPress={onScan} last />
    </View>
    <Text style={styles.profileGroupLabel}>THÔNG TIN</Text>
    <View style={styles.settingsGroup}><ProfileRow icon={CircleHelp} title="Trợ giúp & hỗ trợ" onPress={() => onNotify('Trung tâm trợ giúp sẽ sớm được cập nhật.')} /><ProfileRow icon={Info} title="Về Di Tích Q1" subtitle="Phiên bản 1.0.0" onPress={() => onNotify('Ứng dụng thuyết minh di tích lịch sử Quận 1.')} last /></View>
    <View style={styles.profileFoot}><ShieldMark /><Text>Được tạo nên để kể những câu chuyện của Sài Gòn.</Text></View>
  </ScrollView>;
}

function ProfileRow({ icon: Icon, title, subtitle, onPress, last }) {
  return <Pressable style={[styles.profileSettingRow, last && styles.noBorder]} onPress={onPress}><View style={styles.profileRowIcon}><Icon size={17} color="#E77955" /></View><View style={styles.profileRowCopy}><Text style={styles.profileRowTitle}>{title}</Text>{!!subtitle && <Text style={styles.profileRowSub}>{subtitle}</Text>}</View><ChevronRight size={17} color="#b5aea7" /></Pressable>;
}

function ScannerScreen({ permission, requestPermission, onBack, onScanned, onManual }) {
  if (!permission) return <View style={styles.scannerLoading}><ActivityIndicator color={accent} /></View>;
  return <View style={styles.scannerScreen}><View style={styles.scannerBackdrop}>
    {permission.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} /> : <LinearGradient colors={['#292521', '#4D3C30', '#1B1A19']} style={StyleSheet.absoluteFill}><View style={styles.scannerBackdropArt}><BuildingIllustration color="#C9A37B" large /></View></LinearGradient>}
    <LinearGradient colors={['#0009', 'transparent', '#0009']} style={StyleSheet.absoluteFill} />
    <View style={styles.scannerHeader}><Pressable style={styles.scannerBack} onPress={onBack}><X size={20} color="#fff" /></Pressable><Text style={styles.scannerHeaderTitle}>Quét mã QR</Text><View style={{ width: 40 }} /></View>
    <View style={styles.scannerCenter}><Text style={styles.scannerTitle}>Tìm câu chuyện{'\n'}ngay trước mắt bạn</Text><Text style={styles.scannerSub}>Đưa mã QR tại di tích vào khung hình để nghe thuyết minh.</Text>
      <View style={styles.scanFrame}><View style={[styles.scanCorner, styles.scanCornerTL]} /><View style={[styles.scanCorner, styles.scanCornerTR]} /><View style={[styles.scanCorner, styles.scanCornerBL]} /><View style={[styles.scanCorner, styles.scanCornerBR]} />{permission.granted && <View style={styles.scanBeam} />}</View>
      {permission.granted ? <Text style={styles.cameraReady}>Đang tìm mã QR...</Text> : <Pressable style={styles.permissionButton} onPress={requestPermission}><QrCode size={16} color="#fff" /><Text>Cho phép sử dụng camera</Text></Pressable>}
    </View>
    <View style={styles.scannerBottom}><View style={styles.scannerHint}><Sparkles size={15} color="#F4C68E" /><Text>Không tìm thấy mã? Thử chọn di tích thủ công.</Text></View><Pressable style={styles.manualSelect} onPress={onManual}><MapPin size={16} color="#fff" /><Text>Chọn di tích trong danh sách</Text><ArrowRight size={15} color="#fff" /></Pressable></View>
  </View></View>;
}

function BottomTabs({ activeTab, onChange }) {
  return <View style={styles.bottomTabs}>{tabs.map(({ key, label, icon: Icon }) => {
    const active = activeTab === key;
    return <Pressable key={key} style={styles.tabButton} onPress={() => onChange(key)}><View style={[styles.tabIconWrap, active && styles.tabIconActive]}><Icon size={19} color={active ? accent : '#9B9690'} strokeWidth={active ? 2.3 : 1.8} /></View><Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>{active && <View style={styles.activeTabDot} />}</Pressable>;
  })}</View>;
}

function LanguagePicker({ visible, selected, onClose, onSelect }) {
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
    <Pressable style={styles.modalScrim} onPress={onClose}><Pressable style={styles.languageSheet} onPress={(event) => event.stopPropagation()}>
      <View style={styles.sheetHandle} /><View style={styles.sheetHead}><View><Text style={styles.sheetEyebrow}>CÁ NHÂN HÓA TRẢI NGHIỆM</Text><Text style={styles.sheetTitle}>Chọn ngôn ngữ</Text><Text style={styles.sheetSub}>Nội dung thuyết minh bạn muốn nghe</Text></View><Pressable style={styles.sheetClose} onPress={onClose}><X size={18} color="#77716A" /></Pressable></View>
      {languages.map((item) => <Pressable key={item.code} style={[styles.languageOption, selected.code === item.code && styles.languageOptionSelected]} onPress={() => onSelect(item)}><View style={styles.languageOptionFlag}><Text>{item.flag}</Text></View><View style={styles.languageOptionCopy}><Text style={styles.languageOptionName}>{item.name}</Text><Text style={styles.languageOptionNative}>{item.nativeName}</Text></View>{selected.code === item.code ? <View style={styles.languageChecked}><Check size={15} color="#fff" /></View> : <View style={styles.languageRadio} />}</Pressable>)}
      <Text style={styles.sheetFootnote}>Bạn có thể đổi ngôn ngữ bất cứ lúc nào.</Text>
    </Pressable></Pressable>
  </Modal>;
}

function durationSeconds(value) {
  const [minutes, seconds] = value.split(':').map(Number);
  return minutes * 60 + seconds;
}

function todayLabel() {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date()).toLocaleUpperCase('vi');
}

function scrollHorizontallyWithWheel(event) {
  event.preventDefault();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  event.currentTarget.scrollLeft += delta;
}

function useMouseDragScroll() {
  const dragState = useRef({ startX: 0, startScrollLeft: 0, active: false, moved: false, suppressClick: false });

  return {
    onMouseDown(event) {
      if (event.button !== 0) return;
      const state = dragState.current;
      state.startX = event.clientX;
      state.startScrollLeft = event.currentTarget.scrollLeft;
      state.active = true;
      state.moved = false;
      event.currentTarget.style.cursor = 'grabbing';
    },
    onMouseMove(event) {
      const state = dragState.current;
      if (!state.active) return;
      const delta = event.clientX - state.startX;
      if (Math.abs(delta) > 4) state.moved = true;
      if (!state.moved) return;
      event.preventDefault();
      event.currentTarget.scrollLeft = state.startScrollLeft - delta;
    },
    onMouseUp(event) {
      const state = dragState.current;
      state.active = false;
      state.suppressClick = state.moved;
      event.currentTarget.style.cursor = 'grab';
    },
    onMouseLeave(event) {
      const state = dragState.current;
      state.active = false;
      state.suppressClick = state.moved;
      event.currentTarget.style.cursor = 'grab';
    },
    onClickCapture(event) {
      if (!dragState.current.suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      dragState.current.suppressClick = false;
    },
  };
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

function ShieldMark() { return <View style={styles.shieldMark}><Sparkles size={11} color={accent} /></View>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FBFAF8' },
  apiStatusBanner: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#FFF3E9' },
  apiStatusError: { backgroundColor: '#A43D2A' },
  apiStatusCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  apiStatusText: { flex: 1, color: '#68432F', fontSize: 10, fontWeight: '600' },
  apiRetryButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#ffffff26' },
  apiRetryText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  noSitesCard: { minHeight: 96, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 13, backgroundColor: '#F4F1ED' },
  noSitesText: { color: '#77716B', fontSize: 11, textAlign: 'center' },
  screen: { flex: 1, backgroundColor: '#FBFAF8' },
  fill: { flex: 1, backgroundColor: '#FBFAF8' },
  homeContent: { paddingHorizontal: 16, paddingBottom: 22 },
  appHeader: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: '#FBFAF8' },
  headerTitles: { flex: 1 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  wordmarkIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: accent },
  wordmark: { fontSize: 13, fontWeight: '900', letterSpacing: 1.1, color: ink },
  wordmarkAccent: { color: accent },
  headerTitle: { fontSize: 20, fontWeight: '800', color: ink, letterSpacing: -0.4 },
  headerSubtitle: { marginTop: 2, color: muted, fontSize: 10 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderColor: '#EBE7E2', borderWidth: 1, backgroundColor: '#fff' },
  languageButton: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderWidth: 1, borderColor: '#EBE7E2', borderRadius: 11, backgroundColor: '#fff' },
  languageFlag: { fontSize: 14 },
  languageCode: { color: ink, fontSize: 10, fontWeight: '800' },
  headerOnDark: { backgroundColor: 'transparent' },
  headerSubtitleDark: { color: '#ffffffa8' },
  languageButtonDark: { borderColor: '#ffffff40', backgroundColor: '#ffffff18' },
  roundButtonDark: { borderColor: '#ffffff40', backgroundColor: '#ffffff18' },
  textWhite: { color: '#fff' },
  homeGreeting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 11, marginBottom: 14 },
  greetingKicker: { color: '#A19A93', fontSize: 8, fontWeight: '800', letterSpacing: 1.15 },
  greetingTitle: { marginTop: 5, color: ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.65 },
  greetingSub: { marginTop: 4, color: '#8F8983', fontSize: 10 },
  wave: { fontSize: 19 },
  avatarButton: { position: 'relative', width: 41, height: 41, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ECDDD1', borderRadius: 15, backgroundColor: '#F7E6D9' },
  avatarInitial: { color: '#835A41', fontSize: 11, fontWeight: '900' },
  onlineDot: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderWidth: 2, borderColor: '#FBFAF8', borderRadius: 7, backgroundColor: '#54B688' },
  searchLauncher: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: '#EEEAE6', borderRadius: 12, backgroundColor: '#fff' },
  searchPlaceholder: { flex: 1, color: '#A29B95', fontSize: 10 },
  searchTuning: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F7F5F2' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 23, marginBottom: 11 },
  sectionEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  sectionEyebrowText: { color: accent, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  sectionTitle: { color: ink, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  sectionSub: { marginTop: 3, color: '#A09A94', fontSize: 9 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 2 },
  seeAllText: { color: accent, fontSize: 9, fontWeight: '700' },
  heroCarousel: { gap: 0 },
  featuredCarouselViewport: { width: '100%', alignSelf: 'stretch', flexShrink: 0 },
  featuredCarouselScroll: { width: '100%', flexGrow: 0 },
  featuredCard: { position: 'relative', flexShrink: 0, height: 242, overflow: 'hidden', borderRadius: 17, backgroundColor: '#514238' },
  featuredImage: { opacity: 0.66 },
  photoTint: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', opacity: 0.89 },
  featuredTop: { position: 'absolute', top: 12, right: 12, left: 12, flexDirection: 'row', justifyContent: 'space-between' },
  featuredTag: { height: 27, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, borderWidth: 1, borderColor: '#ffffff38', borderRadius: 6, backgroundColor: '#231e1b55' },
  featuredTagText: { color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  favoriteButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff5c', borderRadius: 11, backgroundColor: '#221e1b44' },
  featuredBottom: { position: 'absolute', right: 15, bottom: 14, left: 15 },
  distancePill: { alignSelf: 'flex-start', height: 26, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#ffffff1e' },
  distancePillText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  distanceDivider: { color: '#ffffff96', fontSize: 15 },
  featuredTitle: { marginTop: 8, color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  featuredDescription: { marginTop: 4, color: '#ffffffd9', fontSize: 15 },
  featuredActions: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12 },
  featuredListen: { height: 54, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 9, backgroundColor: accent },
  featuredListenText: { color: '#fff', fontSize: 16.5, fontWeight: '700' },
  featuredDuration: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  featuredDurationText: { color: '#ffffffdf', fontSize: 16.5 },
  featuredArrow: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto', borderWidth: 1, borderColor: '#ffffff61', borderRadius: 8 },
  carouselMeta: { height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  carouselDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  carouselDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#DED9D3' },
  carouselDotActive: { width: 18, backgroundColor: accent },
  carouselCounter: { color: ink, fontSize: 8, fontWeight: '800' },
  counterMuted: { color: '#AAA39D', fontWeight: '500' },
  quickActions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 7, marginBottom: 2, paddingVertical: 13, borderWidth: 1, borderColor: '#F0ECE8', borderRadius: 13, backgroundColor: '#fff' },
  quickAction: { alignItems: 'center', gap: 6 },
  quickIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  quickIcon_orange: { backgroundColor: '#FFF0E8' },
  quickIcon_blue: { backgroundColor: '#EAF1FC' },
  quickIcon_green: { backgroundColor: '#E9F5EF' },
  quickColor_orange: { color: '#E17850' },
  quickColor_blue: { color: '#6889C7' },
  quickColor_green: { color: '#4D9C7A' },
  quickLabel: { color: '#66615D', fontSize: 8, fontWeight: '600' },
  textOnlyLink: { paddingBottom: 2 },
  horizontalCards: { gap: 10, paddingBottom: 3, paddingRight: 16 },
  miniPlaceCard: { width: 146, overflow: 'hidden', borderWidth: 1, borderColor: '#F0ECE8', borderRadius: 11, backgroundColor: '#fff' },
  miniArtwork: { position: 'relative', height: 110, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  miniDistance: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 6, backgroundColor: '#24201DB8' },
  miniDistanceText: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
  miniPlaceInfo: { paddingHorizontal: 8, paddingTop: 7, paddingBottom: 8 },
  miniPlaceTitle: { color: ink, fontSize: 9, fontWeight: '700' },
  miniPlaceCategory: { marginTop: 3, color: '#A09A94', fontSize: 7 },
  miniAudio: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  miniAudioText: { color: '#817A74', fontSize: 7 },
  buildingArt: { position: 'absolute', bottom: 3, width: 75, height: 54, alignItems: 'center', justifyContent: 'flex-end' },
  buildingArtLarge: { bottom: 31, width: 145, height: 116 },
  artDome: { width: 26, height: 20, borderTopWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#fff1' },
  artRoof: { width: '92%', height: 6, borderRadius: 2 },
  artFacade: { width: '84%', height: 31, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-evenly', paddingHorizontal: 4, borderLeftWidth: 2, borderRightWidth: 2, backgroundColor: '#ffffff18' },
  artColumn: { width: 5, marginTop: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  artWindow: { width: 3, height: 8, marginTop: 9, marginLeft: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#35312C85' },
  artBase: { width: '94%', height: 4, borderRadius: 2 },
  nearbyBanner: { position: 'relative', height: 162, flexDirection: 'row', overflow: 'hidden', marginTop: 21, borderRadius: 14 },
  nearbyBannerCopy: { zIndex: 2, flex: 1, justifyContent: 'center', paddingLeft: 15 },
  livePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 7, backgroundColor: '#ffffff17' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#89D2A2' },
  livePillText: { color: '#fff', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
  nearbyTitle: { marginTop: 7, color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 22, letterSpacing: -0.3 },
  nearbyCopy: { marginTop: 8, color: '#fff', fontSize: 11 },
  nearbyButton: { alignSelf: 'flex-start', height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 14, borderRadius: 8, backgroundColor: accent },
  nearbyButtonText: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
  nearbyIllustration: { position: 'absolute', right: -11, bottom: 0, width: '48%', height: '100%', justifyContent: 'flex-end' },
  glowCircle: { position: 'absolute', top: 13, right: 28, width: 83, height: 83, borderRadius: 50, backgroundColor: '#D6AF7966' },
  homeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 17, marginBottom: 8 },
  homeFooterText: { color: '#AAA39D', fontSize: 8 },
  shieldMark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#FFF0E8' },
  exploreSearch: { height: 43, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: '#ECE8E4', borderRadius: 11, backgroundColor: '#fff' },
  exploreInput: { flex: 1, height: 42, color: ink, fontSize: 10 },
  filterButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#F7F5F2' },
  categoryChips: { gap: 7, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 5 },
  categoryChip: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#EAE6E2', borderRadius: 16, backgroundColor: '#fff' },
  categoryChipActive: { borderColor: ink, backgroundColor: ink },
  categoryChipText: { color: '#79736E', fontSize: 9, fontWeight: '600' },
  categoryChipTextActive: { color: '#fff' },
  exploreResults: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 17, paddingTop: 13, paddingBottom: 7 },
  resultCount: { color: '#A09A94', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  nearbyStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  nearbyStatusText: { color: '#69967C', fontSize: 7, fontWeight: '800', letterSpacing: 0.5 },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5CB987' },
  exploreList: { flex: 1 },
  exploreListContent: { paddingHorizontal: 16, paddingBottom: 14 },
  exploreCard: { flexDirection: 'row', gap: 10, marginBottom: 9, padding: 8, borderWidth: 1, borderColor: '#F0ECE8', borderRadius: 12, backgroundColor: '#fff' },
  exploreArtwork: { position: 'relative', width: 96, height: 102, flex: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 8 },
  artNumber: { position: 'absolute', top: 6, left: 7, color: '#ffffffb8', fontSize: 8, fontWeight: '800' },
  exploreCardInfo: { flex: 1, justifyContent: 'center', minWidth: 0 },
  exploreCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exploreCategory: { color: accent, fontSize: 7, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  explorePlaceName: { marginTop: 5, color: ink, fontSize: 12, fontWeight: '800', letterSpacing: -0.2 },
  exploreAddress: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
  exploreAddressText: { maxWidth: '60%', color: '#928B85', fontSize: 8 },
  dotSep: { color: '#B7B0A9', fontSize: 9 },
  exploreDistance: { color: '#7F7973', fontSize: 8, fontWeight: '600' },
  exploreCardBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9, paddingTop: 7, borderTopWidth: 1, borderTopColor: '#F2EFEC' },
  langFlags: { flexDirection: 'row', alignItems: 'center' },
  langFlag: { marginRight: 2, fontSize: 10 },
  exploreDuration: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  exploreDurationText: { color: '#817A74', fontSize: 7 },
  emptyState: { minHeight: 240, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyTitle: { marginTop: 12, color: ink, fontSize: 13, fontWeight: '700' },
  emptyCopy: { marginTop: 5, color: '#9B948E', fontSize: 9, textAlign: 'center', lineHeight: 15 },
  detailRoot: { flex: 1, backgroundColor: '#FBFAF8' },
  detailScroll: { paddingBottom: 15 },
  detailHero: { position: 'relative', height: 275, overflow: 'hidden', justifyContent: 'flex-end' },
  detailImage: { opacity: 0.56 },
  detailTopBar: { position: 'absolute', top: Platform.OS === 'web' ? 8 : 4, right: 15, left: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailTopActions: { flexDirection: 'row', gap: 7 },
  detailRound: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff52', borderRadius: 12, backgroundColor: '#1D1A185C' },
  detailHeroBottom: { zIndex: 2, paddingHorizontal: 18, paddingBottom: 18 },
  detailHeroCategoryText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  detailHeroTitle: { marginTop: 8, color: '#fff', fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
  detailHeroAddress: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  detailHeroAddressText: { color: '#ffffffd0', fontSize: 9 },
  detailContent: { paddingHorizontal: 16 },
  detailAudioCard: { marginTop: -1, padding: 13, borderWidth: 1, borderColor: '#EFEBE7', borderRadius: 13, backgroundColor: '#fff' },
  audioCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  audioLangRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioLangIcon: { width: 33, height: 33, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#FFF1EA' },
  audioLangName: { color: '#49433F', fontSize: 9, fontWeight: '700' },
  audioVoice: { marginTop: 3, color: '#A19A94', fontSize: 7 },
  audioChangeLang: { flexDirection: 'row', gap: 4, padding: 7, borderWidth: 1, borderColor: '#EFECE8', borderRadius: 7 },
  audioTrack: { marginTop: 15 },
  audioTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  audioTimeText: { color: '#97908A', fontSize: 7 },
  audioProgress: { position: 'relative', height: 4, borderRadius: 4, backgroundColor: '#EEEAE6' },
  audioProgressFill: { width: '9%', height: '100%', borderRadius: 4, backgroundColor: accent },
  audioProgressPlaying: { width: '28%' },
  audioKnob: { position: 'absolute', top: -3, left: '8%', width: 10, height: 10, borderWidth: 2, borderColor: accent, borderRadius: 5, backgroundColor: '#fff' },
  audioKnobPlaying: { left: '27%' },
  audioControlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  skipButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F7F5F2' },
  largePlay: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: accent, shadowColor: accent, shadowOpacity: 0.28, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  speedPill: { paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: '#ECE8E4', borderRadius: 7 },
  speedText: { color: '#77716B', fontSize: 8, fontWeight: '700' },
  detailStoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 19 },
  storyEyebrow: { color: accent, fontSize: 7, fontWeight: '800', letterSpacing: 0.95 },
  storyTitle: { marginTop: 4, color: ink, fontSize: 17, fontWeight: '800' },
  shareButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ECE8E4', borderRadius: 10, backgroundColor: '#fff' },
  storyText: { marginTop: 9, color: '#716B65', fontSize: 10, lineHeight: 18 },
  factStrip: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, padding: 10, borderWidth: 1, borderColor: '#F0ECE8', borderRadius: 10, backgroundColor: '#fff' },
  factIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#FFF1EA' },
  factCopy: { flex: 1 },
  factLabel: { color: '#A19A94', fontSize: 7, fontWeight: '700', letterSpacing: 0.6 },
  factValue: { marginTop: 4, color: '#514B46', fontSize: 9, fontWeight: '600' },
  locationCard: { marginTop: 10, padding: 8, borderWidth: 1, borderColor: '#F0ECE8', borderRadius: 10, backgroundColor: '#fff' },
  locationMapArt: { position: 'relative', height: 82, overflow: 'hidden', borderRadius: 7, backgroundColor: '#EBEFE7' },
  mapStreetLine: { position: 'absolute', top: '49%', left: -10, width: '115%', height: 8, backgroundColor: '#fff', transform: [{ rotate: '-6deg' }] },
  mapBlockA: { position: 'absolute', top: 8, left: 13, width: 70, height: 27, borderRadius: 4, backgroundColor: '#DDE7D9' },
  mapBlockB: { position: 'absolute', right: 20, bottom: 7, width: 80, height: 25, borderRadius: 4, backgroundColor: '#DDE7D9' },
  locationPin: { position: 'absolute', top: 24, left: '48%' },
  locationText: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 8 },
  locationAddress: { marginTop: 4, color: '#4F4944', fontSize: 9, fontWeight: '700' },
  locationDistrict: { marginTop: 3, color: '#9A938D', fontSize: 8 },
  navigateButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: accent },
  detailSticky: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'web' ? 8 : 5, borderTopWidth: 1, borderTopColor: '#F0ECE8', backgroundColor: '#fff' },
  stickyStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 7 },
  stickyStatusText: { color: '#849185', fontSize: 7, fontWeight: '700', letterSpacing: 0.6 },
  stickyPlay: { height: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 9, backgroundColor: accent },
  stickyPlayText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  mapScreen: { flex: 1 },
  mapCanvas: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#F0F3EE' },
  mapTileOne: { position: 'absolute', top: '21%', left: '6%', width: '28%', height: '18%', borderRadius: 8, backgroundColor: '#E0E9DE' },
  mapTileTwo: { position: 'absolute', top: '23%', left: '42%', width: '28%', height: '19%', borderRadius: 8, backgroundColor: '#E7EBDD' },
  mapTileThree: { position: 'absolute', top: '52%', left: '7%', width: '34%', height: '18%', borderRadius: 8, backgroundColor: '#E4EBDD' },
  mapTileFour: { position: 'absolute', top: '53%', left: '48%', width: '27%', height: '21%', borderRadius: 8, backgroundColor: '#E1E9DD' },
  mapTileFive: { position: 'absolute', top: '76%', left: '14%', width: '27%', height: '15%', borderRadius: 8, backgroundColor: '#E7EBDD' },
  mapRoadMain: { position: 'absolute', top: '45%', left: '-15%', width: '130%', height: 14, backgroundColor: '#fff', transform: [{ rotate: '-7deg' }] },
  mapRoadVertical: { position: 'absolute', top: '10%', left: '37%', width: 11, height: '80%', backgroundColor: '#fff', transform: [{ rotate: '12deg' }] },
  mapRoadDiagonal: { position: 'absolute', top: '20%', left: '70%', width: 9, height: '80%', backgroundColor: '#fff', transform: [{ rotate: '-19deg' }] },
  mapPark: { position: 'absolute', top: '25%', left: '72%', width: 66, height: 75, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#D8E8D5' },
  mapParkText: { color: '#799074', fontSize: 7, fontWeight: '800', lineHeight: 11, textAlign: 'center', letterSpacing: 0.5 },
  mapWater: { position: 'absolute', top: '2%', right: '-21%', width: '30%', height: '66%', alignItems: 'center', justifyContent: 'center', borderRadius: 90, backgroundColor: '#DBE9E9', transform: [{ rotate: '18deg' }] },
  mapWaterText: { color: '#88A8A6', fontSize: 7, fontWeight: '800', letterSpacing: 1, transform: [{ rotate: '72deg' }] },
  mapStreet: { position: 'absolute', color: '#9AA394', fontSize: 7, fontWeight: '600', letterSpacing: 0.4 },
  mapPoiPin: { position: 'absolute', zIndex: 3, width: 34, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', borderRadius: 19, backgroundColor: '#78927B', transform: [{ rotate: '-45deg' }], shadowColor: '#414B3C', shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  mapPoiPinSelected: { width: 39, height: 43, backgroundColor: accent },
  mapPin1: { top: '40%', left: '21%' },
  mapPin2: { top: '57%', left: '50%' },
  mapPin3: { top: '32%', left: '61%' },
  mapPin4: { top: '66%', left: '29%' },
  mapPin5: { top: '70%', left: '69%' },
  mapPin6: { top: '48%', left: '79%' },
  mapTopBar: { position: 'absolute', top: 0, right: 0, left: 0, paddingTop: 4, paddingBottom: 8, backgroundColor: '#FBFAF8F0' },
  mapLocationButton: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 10, borderWidth: 1, borderColor: '#EFEAE5', borderRadius: 11, backgroundColor: '#fff' },
  mapLocationTitle: { color: ink, fontSize: 9, fontWeight: '700' },
  mapLocationSub: { marginTop: 2, color: '#9A938D', fontSize: 7 },
  mapRecenter: { position: 'absolute', right: 15, bottom: 256, width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ECE8E4', borderRadius: 13, backgroundColor: '#fff', elevation: 2 },
  mapZoom: { position: 'absolute', right: 15, bottom: 204, width: 34, height: 66, alignItems: 'center', justifyContent: 'space-evenly', borderWidth: 1, borderColor: '#ECE8E4', borderRadius: 10, backgroundColor: '#fff', elevation: 2 },
  mapZoomText: { color: '#514B46', fontSize: 16 },
  mapZoomDivider: { width: 18, height: 1, backgroundColor: '#EBE7E2' },
  mapBottom: { position: 'absolute', right: 0, bottom: 0, left: 0, paddingHorizontal: 15, paddingBottom: 12, borderTopLeftRadius: 19, borderTopRightRadius: 19, backgroundColor: '#FBFAF8', elevation: 8 },
  mapBottomHandle: { alignSelf: 'center', width: 33, height: 4, marginTop: 7, borderRadius: 4, backgroundColor: '#D8D2CC' },
  mapResultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 9 },
  mapResultEyebrow: { color: '#A29A93', fontSize: 7, fontWeight: '800', letterSpacing: 0.7 },
  mapResultTitle: { marginTop: 3, color: ink, fontSize: 14, fontWeight: '800' },
  resultCountMuted: { color: '#9B948E', fontSize: 9, fontWeight: '500' },
  mapFilterButton: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EAE6E2', borderRadius: 9, backgroundColor: '#fff' },
  mapSelectedCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 7, borderWidth: 1, borderColor: '#EEE9E4', borderRadius: 11, backgroundColor: '#fff' },
  mapSelectedArtwork: { width: 73, height: 75, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 7 },
  mapSelectedCopy: { flex: 1 },
  nearbyLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  nearbyLineText: { color: '#6F927A', fontSize: 6, fontWeight: '800', letterSpacing: 0.35 },
  mapSelectedTitle: { marginTop: 5, color: ink, fontSize: 10, fontWeight: '800' },
  mapSelectedAddress: { marginTop: 3, color: '#958E88', fontSize: 7 },
  mapSelectedAction: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 5, backgroundColor: accent },
  mapSelectedActionText: { color: '#fff', fontSize: 7, fontWeight: '700' },
  mapThumbs: { gap: 6, paddingVertical: 8 },
  mapThumb: { height: 27, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: '#ECE8E4', borderRadius: 14, backgroundColor: '#fff' },
  mapThumbSelected: { borderColor: ink, backgroundColor: ink },
  mapThumbText: { color: '#77716B', fontSize: 7, fontWeight: '600' },
  savedContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20 },
  savedBanner: { height: 142, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden', marginBottom: 14, paddingHorizontal: 16, borderRadius: 14 },
  savedBannerKicker: { color: '#ffffffad', fontSize: 7, fontWeight: '800', letterSpacing: 1 },
  savedBannerTitle: { marginTop: 8, color: '#fff', fontSize: 19, fontWeight: '800', lineHeight: 24 },
  savedBannerIcon: { marginRight: 6, opacity: 0.75 },
  emptyButton: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13, paddingHorizontal: 11, borderRadius: 8, backgroundColor: accent },
  emptyButtonText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  profileContent: { paddingBottom: 24 },
  profileHero: { position: 'relative', alignItems: 'center', overflow: 'hidden', marginHorizontal: 16, marginTop: 10, paddingTop: 19, paddingBottom: 15, borderRadius: 15 },
  profileAvatarLarge: { position: 'relative', width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#ffffffbd', borderRadius: 22, backgroundColor: '#FBF4EC' },
  profileAvatarText: { color: '#8D6048', fontSize: 16, fontWeight: '900' },
  profileName: { marginTop: 8, color: '#3D352F', fontSize: 13, fontWeight: '800' },
  profileSince: { marginTop: 3, color: '#81766D', fontSize: 8 },
  profileStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '100%', marginTop: 14, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#ffffff80' },
  profileStatItem: { alignItems: 'center' },
  profileStatValue: { color: '#4A4038', fontSize: 12, fontWeight: '800' },
  profileStatLabel: { marginTop: 3, color: '#897F75', fontSize: 6, fontWeight: '700', letterSpacing: 0.4 },
  profileStatDivider: { width: 1, height: 21, backgroundColor: '#ffffff99' },
  profileGroupLabel: { marginTop: 19, marginBottom: 7, paddingHorizontal: 18, color: '#A29A93', fontSize: 7, fontWeight: '800', letterSpacing: 0.85 },
  settingsGroup: { marginHorizontal: 16, paddingHorizontal: 11, borderWidth: 1, borderColor: '#F0ECE8', borderRadius: 12, backgroundColor: '#fff' },
  profileSettingRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: '#F2EFEC' },
  noBorder: { borderBottomWidth: 0 },
  profileRowIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#FFF2EB' },
  profileRowCopy: { flex: 1 },
  profileRowTitle: { color: '#514B46', fontSize: 9, fontWeight: '700' },
  profileRowSub: { marginTop: 3, color: '#A09A94', fontSize: 7 },
  profileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  profileFootText: { color: '#AAA39D', fontSize: 7 },
  scannerScreen: { flex: 1, backgroundColor: '#191817' },
  scannerBackdrop: { flex: 1, position: 'relative', justifyContent: 'space-between', overflow: 'hidden', paddingHorizontal: 19, paddingBottom: 14 },
  scannerHeader: { zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 7 },
  scannerBack: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ffffff45', borderRadius: 12, backgroundColor: '#0004' },
  scannerHeaderTitle: { color: '#fff', fontSize: 12, fontWeight: '700' },
  scannerCenter: { zIndex: 2, alignItems: 'center', marginTop: -24 },
  scannerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 25, textAlign: 'center' },
  scannerSub: { maxWidth: 245, marginTop: 7, color: '#ffffffb8', fontSize: 9, lineHeight: 15, textAlign: 'center' },
  scanFrame: { position: 'relative', width: 230, height: 230, marginTop: 25 },
  scanCorner: { position: 'absolute', width: 32, height: 32, borderColor: '#fff', borderWidth: 3 },
  scanCornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  scanCornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  scanCornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  scanCornerBR: { right: 0, bottom: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  scanBeam: { position: 'absolute', top: '49%', left: 9, width: '92%', height: 2, backgroundColor: '#F55B3B', shadowColor: accent, shadowOpacity: 1, shadowRadius: 8 },
  cameraReady: { marginTop: 13, color: '#ffffffd1', fontSize: 9 },
  permissionButton: { height: 39, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13, paddingHorizontal: 13, borderRadius: 8, backgroundColor: accent },
  permissionButtonText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  scannerBottom: { zIndex: 2, gap: 10 },
  scannerHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 2 },
  scannerHintText: { color: '#ffffffbf', fontSize: 8 },
  manualSelect: { height: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#ffffff75', borderRadius: 9, backgroundColor: '#ffffff12' },
  manualSelectText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  scannerBackdropArt: { position: 'absolute', right: '22%', bottom: '31%', width: 160, height: 130, opacity: 0.6 },
  scannerLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottomTabs: { height: 59, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 9, borderTopWidth: 1, borderTopColor: '#F0ECE8', backgroundColor: '#fff' },
  tabButton: { position: 'relative', minWidth: 61, alignItems: 'center', justifyContent: 'center', gap: 1 },
  tabIconWrap: { width: 30, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  tabIconActive: { backgroundColor: '#FFF0E9' },
  tabLabel: { color: '#A49D96', fontSize: 7, fontWeight: '600' },
  tabLabelActive: { color: accent, fontWeight: '800' },
  activeTabDot: { position: 'absolute', top: -5, width: 3, height: 3, borderRadius: 2, backgroundColor: accent },
  modalScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#211D1A77' },
  languageSheet: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: Platform.OS === 'web' ? 16 : 28, borderTopLeftRadius: 21, borderTopRightRadius: 21, backgroundColor: '#FBFAF8' },
  sheetHandle: { alignSelf: 'center', width: 35, height: 4, marginBottom: 17, borderRadius: 3, backgroundColor: '#D9D3CD' },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 13 },
  sheetEyebrow: { color: accent, fontSize: 7, fontWeight: '800', letterSpacing: 0.9 },
  sheetTitle: { marginTop: 4, color: ink, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  sheetSub: { marginTop: 3, color: '#99928C', fontSize: 8 },
  sheetClose: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F0ECE8' },
  languageOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#EEEAE6', borderRadius: 10, backgroundColor: '#fff' },
  languageOptionSelected: { borderColor: accent, backgroundColor: '#FFF7F3' },
  languageOptionFlag: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#F7F5F2' },
  languageOptionFlagText: { fontSize: 16 },
  languageOptionCopy: { flex: 1 },
  languageOptionName: { color: '#4F4944', fontSize: 10, fontWeight: '700' },
  languageOptionNative: { marginTop: 2, color: '#A29A94', fontSize: 7 },
  languageChecked: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: accent },
  languageRadio: { width: 17, height: 17, borderWidth: 1.5, borderColor: '#D9D3CD', borderRadius: 9 },
  sheetFootnote: { marginTop: 7, color: '#A9A29B', fontSize: 7, textAlign: 'center' },
  toast: { position: 'absolute', zIndex: 30, right: 19, bottom: 75, left: 19, minHeight: 39, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#302C28', elevation: 5 },
  toastText: { color: '#fff', fontSize: 9, fontWeight: '600' },
});
