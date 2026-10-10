import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import TopBar from './components/TopBar';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import PromoBannerDisplay from './components/PromoBannerDisplay';
import LoginModal from './components/LoginModal';
import MiniPlayer from './components/MiniPlayer';
import InstallPrompt from './components/InstallPrompt';
import VerifyEmailBanner from './components/VerifyEmailBanner';
import { PlayerProvider } from './components/PlayerContext';
import Home from './pages/Home';
import Search from './pages/Search';
import Watch from './pages/Watch';
import Channel from './pages/Channel';
import CreateChannel from './pages/CreateChannel';
import EditChannel from './pages/EditChannel';
import MyChannel from './pages/MyChannel';
import Upload from './pages/Upload';
import WatchLater from './pages/WatchLater';
import Subscriptions from './pages/Subscriptions';
import Notifications from './pages/Notifications';
import History from './pages/History';
import Playlists from './pages/Playlists';
import PlaylistDetail from './pages/PlaylistDetail';
import MyVideos from './pages/MyVideos';
import GoLive from './pages/GoLive';
import LiveList from './pages/LiveList';
import LiveWatch from './pages/LiveWatch';
import LiveTV from './pages/LiveTV';
import LiveTVWatch from './pages/LiveTVWatch';
import ParentalSettings from './pages/ParentalSettings';
import Sports from './pages/Sports';
import SportsMatchDetail from './pages/SportsMatchDetail';
import Radio from './pages/Radio';
import RadioPlayer from './pages/RadioPlayer';
import LiveTvRecordings from './pages/LiveTvRecordings';
import AdminAds from './pages/AdminAds';
import AdminAdNetworks from './pages/AdminAdNetworks';
import TwoFASettings from './pages/TwoFASettings';
import Preferences from './pages/Preferences';
import ClipView from './pages/ClipView';
import Referrals from './pages/Referrals';
import CreatorStudio from './pages/CreatorStudio';
import TagView from './pages/TagView';
import GenreView from './pages/GenreView';
import PersonView from './pages/PersonView';
import Podcasts from './pages/Podcasts';
import SeriesList from './pages/SeriesList';
import SeriesDetail from './pages/SeriesDetail';
import ShortsFeed from './pages/ShortsFeed';
import BuyMessages from './pages/BuyMessages';
import MyMemberships from './pages/MyMemberships';
import Analytics from './pages/Analytics';
import HelpCenter from './pages/HelpCenter';
import VerifyEmail from './pages/VerifyEmail';
import Legal from './pages/Legal';
import { api, getCachedUser, getToken, clearAuth, type User } from './lib/api';


const HOME_CHIPS = [
  { icon: '🎓', label: 'Study' },
  { icon: '🎬', label: 'Movies' },
  { icon: '🎭', label: 'Drama' },
  { icon: '📺', label: 'Web Series' },
  { icon: '🎵', label: 'Video Song' },
  { icon: '🎧', label: 'Audio Song' },
  { icon: '📡', label: 'Live TV' },
  { icon: '📻', label: 'Radio' },
  { icon: '🔴', label: 'Live Streaming' },
  { icon: '📰', label: 'Article' },
  { icon: '🎵', label: 'Music' },
  { icon: '⚽', label: 'Sports' },
  { icon: '🎮', label: 'Gaming' },
  { icon: '💎', label: 'Memberships' },
];

function CategoryChips() {
  return (
    <div className="mf-sub-header">
      <button className="mf-chip-fixed">All</button>
      <div className="mf-chips-scroll">
        <div className="mf-chips-track">
          {[...HOME_CHIPS, ...HOME_CHIPS].map((c, i) => (
            <button key={i} className="mf-chip">{c.icon} {c.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppInner() {
  const [user, setUser] = useState<User | null>(getCachedUser());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(setUser).catch(() => {
      clearAuth();
      setUser(null);
    });
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  function handleOpenLogin() {
    try {
      sessionStorage.setItem('mf_return_to', location.pathname + location.search);
    } catch {}
    setShowLogin(true);
  }

  function handleSignOut() {
    clearAuth();
    setUser(null);
    navigate('/');
  }

  function handleSearch(q: string) {
    if (!q) { navigate('/'); return; }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  function requireSignIn() {
    try {
      sessionStorage.setItem('mf_return_to', location.pathname + location.search);
    } catch {}
    setShowLogin(true);
  }

  return (
    <>
      <TopBar
        user={user}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onOpenLogin={() => setShowLogin(true)}
        onLogout={handleSignOut}
      />
      <div className="mf-layout">
        <Sidebar expanded={!sidebarCollapsed} />
        <div className="mf-main-col">
          <CategoryChips />
          <main className="mf-content">
          <PromoBannerDisplay placement="top" />
          <VerifyEmailBanner />
          <ErrorBoundary>
          <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/watch/:id" element={<Watch onSignIn={requireSignIn} />} />
        <Route path="/clip/:id" element={<ClipView onSignIn={requireSignIn} />} />
        <Route path="/referrals" element={<Referrals onSignIn={requireSignIn} />} />
        <Route path="/tag/:tag" element={<TagView />} />
        <Route path="/genre/:genre" element={<GenreView />} />
        <Route path="/person/:name" element={<PersonView />} />
        <Route path="/watch-later" element={<WatchLater onSignIn={requireSignIn} />} />
        <Route path="/subscriptions" element={<Subscriptions onSignIn={requireSignIn} />} />
        <Route path="/notifications" element={<Notifications onSignIn={requireSignIn} />} />
        <Route path="/history" element={<History onSignIn={requireSignIn} />} />
        <Route path="/playlists" element={<Playlists onSignIn={requireSignIn} />} />
        <Route path="/playlist/:id" element={<PlaylistDetail onSignIn={requireSignIn} />} />
        <Route path="/my-videos" element={<MyVideos onSignIn={requireSignIn} />} />
        <Route path="/live" element={<LiveList />} />
        <Route path="/podcasts" element={<Podcasts />} />
        <Route path="/shorts" element={<ShortsFeed onSignIn={requireSignIn} />} />
        <Route path="/buy-messages" element={<BuyMessages onSignIn={requireSignIn} />} />
        <Route path="/my-memberships" element={<MyMemberships onSignIn={requireSignIn} />} />
        <Route path="/analytics" element={<Analytics user={user} onSignIn={requireSignIn} />} />
        <Route path="/studio" element={<CreatorStudio onSignIn={requireSignIn} />} />
        <Route path="/help" element={<HelpCenter onSignIn={requireSignIn} />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/legal" element={<Legal onSignIn={requireSignIn} />} />
        <Route path="/legal/:doc" element={<Legal onSignIn={requireSignIn} />} />
        <Route path="/shorts/:id" element={<ShortsFeed onSignIn={requireSignIn} />} />
        <Route path="/series" element={<SeriesList onSignIn={requireSignIn} />} />
        <Route path="/series/:id" element={<SeriesDetail onSignIn={requireSignIn} />} />
        <Route path="/live/:id" element={<LiveWatch onSignIn={requireSignIn} />} />
            <Route path="/live-tv" element={<LiveTV onSignIn={requireSignIn} />} />
            <Route path="/live-tv/:id" element={<LiveTVWatch onSignIn={requireSignIn} />} />
            <Route path="/live-tv/recordings" element={<LiveTvRecordings onSignIn={requireSignIn} />} />
            <Route path="/admin/ads" element={<AdminAds onSignIn={requireSignIn} />} />
            <Route path="/admin/ads/networks" element={<AdminAdNetworks onSignIn={requireSignIn} />} />
            <Route path="/parental" element={<ParentalSettings onSignIn={requireSignIn} />} />
            <Route path="/sports" element={<Sports onSignIn={requireSignIn} />} />
            <Route path="/sports/match/:id" element={<SportsMatchDetail onSignIn={requireSignIn} />} />
            <Route path="/radio" element={<Radio onSignIn={requireSignIn} />} />
            <Route path="/radio/:id" element={<RadioPlayer onSignIn={requireSignIn} />} />
        <Route path="/settings/security" element={<TwoFASettings user={user} onSignIn={requireSignIn} />} />
        <Route path="/settings/preferences" element={<Preferences onSignIn={requireSignIn} />} />
        <Route path="/go-live" element={<GoLive user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/upload" element={<Upload user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/new" element={<CreateChannel user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/me" element={<MyChannel user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/me/edit" element={<EditChannel user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/:id" element={<Channel />} />
          </Routes>
          </ErrorBoundary>
          </main>
        </div>
      </div>


      <MiniPlayer />
      <InstallPrompt />

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={(u) => { setUser(u); setShowLogin(false); }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <AppInner />
    </PlayerProvider>
  );
}
