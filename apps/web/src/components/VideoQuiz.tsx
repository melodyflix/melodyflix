import { useEffect, useState } from 'react';
import {
  getVideoQuiz, answerQuiz, deleteQuiz,
  getCachedUser,
  type Quiz,
} from '../lib/api';

interface Props {
  videoId: string;
  videoOwnerId?: string;
  onSignIn: () => void;
  onToast?: (msg: string) => void;
}

export default function VideoQuiz({ videoId, videoOwnerId, onSignIn, onToast }: Props) {
  const me = getCachedUser();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getVideoQuiz(videoId);
      setQuiz(res.quiz);
    } catch {
      setQuiz(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [videoId]);

  async function handleAnswer(optionId: string) {
    if (!me) { onSignIn(); return; }
    if (!quiz || busy) return;
    if (quiz.user_response_option_id) return;
    setBusy(true);
    try {
      const res = await answerQuiz(quiz.id, optionId);
      setQuiz(res.quiz);
      if (res.quiz.user_was_correct === 1) {
        onToast?.('🎉 Correct!');
      } else {
        onToast?.('❌ Not quite — see the correct answer');
      }
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to submit answer');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!quiz) return;
    if (!confirm('Delete this quiz?')) return;
    setBusy(true);
    try {
      await deleteQuiz(quiz.id);
      setQuiz(null);
      onToast?.('Quiz deleted');
    } catch (err) {
      onToast?.((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !quiz) return null;

  const canManage = !!me && !!videoOwnerId && me.id === videoOwnerId;
  const hasAnswered = !!quiz.user_response_option_id;
  const showResults = hasAnswered || quiz.is_closed === 1;
  const total = quiz.total_responses;

  return (
    <div className="mf-poll mf-quiz">
      <div className="mf-poll-header">
        <span className="mf-poll-badge" style={{ background: '#fef3c7', color: '#92400e' }}>🧠 Quiz</span>
        {quiz.is_closed === 1 && <span className="mf-poll-closed">Closed</span>}
        {hasAnswered && quiz.user_was_correct !== null && (
          <span
            className="mf-poll-closed"
            style={{
              background: quiz.user_was_correct ? '#dcfce7' : '#fee2e2',
              color: quiz.user_was_correct ? '#166534' : '#991b1b',
            }}
          >
            {quiz.user_was_correct ? '✓ Correct' : '✗ Incorrect'}
          </span>
        )}
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
      <div className="mf-poll-question">{quiz.question}</div>

      <div className="mf-poll-options">
        {quiz.options.map((opt) => {
          const pct = total > 0 ? Math.round((opt.response_count / total) * 100) : 0;
          const isMyAnswer = quiz.user_response_option_id === opt.id;
          const isCorrect = quiz.correct_option_id === opt.id;
          const revealCorrect = showResults && isCorrect;
          const revealWrong = showResults && isMyAnswer && !isCorrect;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={busy || showResults}
              onClick={() => handleAnswer(opt.id)}
              className={`mf-poll-option ${isMyAnswer ? 'mf-poll-option-mine' : ''} ${showResults ? 'mf-poll-option-static' : ''}`}
              style={{
                borderColor: revealCorrect ? '#16a34a' : revealWrong ? '#dc2626' : undefined,
                background: revealCorrect ? '#dcfce7' : revealWrong ? '#fee2e2' : undefined,
              }}
            >
              {showResults && (
                <div
                  className="mf-poll-bar"
                  style={{
                    width: `${pct}%`,
                    background: revealCorrect ? 'rgba(22, 163, 74, 0.18)' : 'rgba(6, 95, 212, 0.13)',
                  }}
                />
              )}
              <span className="mf-poll-option-text">
                {revealCorrect && '✓ '}
                {revealWrong && '✗ '}
                {isMyAnswer && !showResults && ''}
                {opt.text}
              </span>
              {showResults && (
                <span className="mf-poll-pct">
                  {pct}% <span className="mf-poll-count">({opt.response_count})</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {showResults && quiz.explanation && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 13,
            color: '#334155',
            lineHeight: 1.5,
          }}
        >
          💡 <strong>Explanation:</strong> {quiz.explanation}
        </div>
      )}

      <div className="mf-poll-footer">
        {total} {total === 1 ? 'response' : 'responses'}
        {total > 0 && <> · <span style={{ color: '#16a34a', fontWeight: 600 }}>{Math.round((quiz.correct_count / total) * 100)}% got it right</span></>}
        {!showResults && me && <span style={{ marginLeft: 8 }}>· Tap to answer</span>}
        {!showResults && !me && (
          <span style={{ marginLeft: 8 }}>
            · <a onClick={onSignIn} style={{ color: '#065fd4', cursor: 'pointer' }}>Sign in to answer</a>
          </span>
        )}
      </div>
    </div>
  );
}
