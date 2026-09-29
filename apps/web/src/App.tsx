import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import TopBar from './components/TopBar';
import LoginModal from './components/LoginModal';
import MiniPlayer from './components/MiniPlayer';
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
import TwoFASettings from './pages/TwoFASettings';
import Podcasts from './pages/Podcasts';
import SeriesList from './pages/SeriesList';
import SeriesDetail from './pages/SeriesDetail';
import ShortsFeed from './pages/ShortsFeed';
import BuyMessages from './pages/BuyMessages';
import { api, getCachedUser, getToken, clearAuth, type User } from './lib/api';

function AppInner() {
  const [user, setUser] = useState<User | null>(getCachedUser());
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
        onLogoClick={() => navigate('/')}
        onSearch={handleSearch}
        onSignIn={() => setShowLogin(true)}
        onSignOut={handleSignOut}
        onMyChannel={() => navigate('/channel/me')}
        onUpload={() => navigate('/upload')}
        onWatchLater={() => navigate('/watch-later')}
        onSubscriptions={() => navigate('/subscriptions')}
        onNotifications={() => navigate('/notifications')}
        onHistory={() => navigate('/history')}
        onPlaylists={() => navigate('/playlists')}
        onMyVideos={() => navigate('/my-videos')}
        onGoLive={() => navigate('/go-live')}
        onLive={() => navigate('/live')}
        onSettings={() => navigate('/settings/security')}
        onPodcasts={() => navigate('/podcasts')}
        onSeries={() => navigate('/series')}
        onShorts={() => navigate('/shorts')}
      />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/watch/:id" element={<Watch onSignIn={requireSignIn} />} />
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
        <Route path="/shorts/:id" element={<ShortsFeed onSignIn={requireSignIn} />} />
        <Route path="/series" element={<SeriesList onSignIn={requireSignIn} />} />
        <Route path="/series/:id" element={<SeriesDetail onSignIn={requireSignIn} />} />
        <Route path="/live/:id" element={<LiveWatch onSignIn={requireSignIn} />} />
        <Route path="/settings/security" element={<TwoFASettings user={user} onSignIn={requireSignIn} />} />
        <Route path="/go-live" element={<GoLive user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/upload" element={<Upload user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/new" element={<CreateChannel user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/me" element={<MyChannel user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/me/edit" element={<EditChannel user={user} onSignIn={() => setShowLogin(true)} />} />
        <Route path="/channel/:id" element={<Channel />} />
      </Routes>

      <MiniPlayer />

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
