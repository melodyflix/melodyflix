import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listAllSeries, getCachedUser, createSeries,
  type Series,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function SeriesList({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listAllSeries(50, 0);
      setSeries(res.series);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!me) { onSignIn(); return; }
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const s = await createSeries({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      setShowCreate(false);
      navigate(`/series/${s.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="mf-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>📺 Series</h1>
          <div style={{ color: '#606060', fontSize: 14 }}>
            {series.length} series · Episodes, seasons, binge-watching
          </div>
        </div>
        {me && (
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '10px 20px' }}
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel' : '+ New series'}
          </button>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div className="mf-form-group">
            <label className="mf-label">Series title</label>
            <input
              className="mf-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. My Documentary Series"
              required
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Description (optional)</label>
            <textarea
              className="mf-input"
              style={{ minHeight: 80 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>
          <button
            className="mf-btn-primary"
            type="submit"
            disabled={busy || !title.trim()}
            style={{ width: '100%', padding: 12 }}
          >
            {busy ? 'Creating...' : 'Create series'}
          </button>
        </form>
      )}

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading series...</div>
      ) : series.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No series yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            {me ? 'Create your first series to organize episodes' : 'Check back later'}
          </div>
        </div>
      ) : (
        <div className="mf-grid">
          {series.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/series/${s.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16 / 9',
                  background: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #a855f7 100%)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 48,
                }}
              >
                📺
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 10,
                    background: 'rgba(0,0,0,0.6)',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  {s.status}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    right: 10,
                    background: 'rgba(0,0,0,0.7)',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {s.total_seasons}S · {s.total_episodes}E
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, marginBottom: 4 }}>
                  {s.title}
                </div>
                {s.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#606060',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {s.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
