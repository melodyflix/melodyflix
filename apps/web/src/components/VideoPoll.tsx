import { useEffect, useState } from 'react';
import {
  getVideoPoll, votePoll, deletePoll,
  getCachedUser,
  type Poll,
} from '../lib/api';

interface Props {
  videoId: string;
  videoOwnerId?: string;
  onSignIn: () => void;
  onToast?: (msg: string) => void;
}

export default function VideoPoll({ videoId, videoOwnerId, onSignIn, onToast }: Props) {
  const me = getCachedUser();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getVideoPoll(videoId);
      setPoll(res.poll);
    } catch {
      setPoll(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [videoId]);

  async function handleVote(optionId: string) {
    if (!me) { onSignIn(); return; }
    if (!poll || busy) return;
    if (poll.user_vote_option_id) return;
    setBusy(true);
    try {
      const res = await votePoll(poll.id, optionId);
      setPoll(res.poll);
    } catch (err) {
      onToast?.((err as Error).message || 'Vote failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!poll) return;
    if (!confirm('Delete this poll?')) return;
    setBusy(true);
    try {
      await deletePoll(poll.id);
      setPoll(null);
      onToast?.('Poll deleted');
    } catch (err) {
      onToast?.((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !poll) return null;

  const canManage = !!me && !!videoOwnerId && me.id === videoOwnerId;
  const hasVoted = !!poll.user_vote_option_id;
  const showResults = hasVoted || poll.is_closed === 1;
  const total = poll.total_votes;

  return (
    <div className="mf-poll">
      <div className="mf-poll-header">
        <span className="mf-poll-badge">📊 Poll</span>
        {poll.is_closed === 1 && <span className="mf-poll-closed">Closed</span>}
        {canManage && (
          <button
            className="mf-btn-text"
            onClick={handleDelete}
            disabled={busy}
            style={{ marginLeft: 'auto', fontSize: 12, color: '#dc2626' }}
          >
            Delete
          </button>
        )}
      </div>
      <div className="mf-poll-question">{poll.question}</div>

      <div className="mf-poll-options">
        {poll.options.map((opt) => {
          const pct = total > 0 ? Math.round((opt.vote_count / total) * 100) : 0;
          const isMyVote = poll.user_vote_option_id === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={busy || showResults}
              onClick={() => handleVote(opt.id)}
              className={`mf-poll-option ${isMyVote ? 'mf-poll-option-mine' : ''} ${showResults ? 'mf-poll-option-static' : ''}`}
            >
              {showResults && (
                <div
                  className="mf-poll-bar"
                  style={{ width: `${pct}%` }}
                />
              )}
              <span className="mf-poll-option-text">
                {isMyVote && '✓ '}
                {opt.text}
              </span>
              {showResults && (
                <span className="mf-poll-pct">
                  {pct}% <span className="mf-poll-count">({opt.vote_count})</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mf-poll-footer">
        {total} {total === 1 ? 'vote' : 'votes'}
        {!showResults && me && <span style={{ marginLeft: 8 }}>· Tap to vote</span>}
        {!showResults && !me && (
          <span style={{ marginLeft: 8 }}>
            · <a onClick={onSignIn} style={{ color: '#065fd4', cursor: 'pointer' }}>Sign in to vote</a>
          </span>
        )}
      </div>
    </div>
  );
}
