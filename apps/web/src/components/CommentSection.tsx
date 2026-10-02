import { useEffect, useState, useRef } from 'react';
import {
  listCommentsPaginated, createComment, updateComment, deleteComment, likeComment, reportComment,
  pinComment, unpinComment, toggleCreatorHeart,
  getCachedUser,
  timeAgo,
  type Comment,
  type CommentSort,
} from '../lib/api';

interface Props {
  videoId: string;
  videoOwnerId?: string;
  onSignIn: () => void;
  onSeek?: (seconds: number) => void;
}

const REPORT_REASONS = [
  { key: 'spam', label: 'Spam or misleading' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'misinformation', label: 'Misinformation' },
  { key: 'other', label: 'Other' },
];

const SORT_OPTIONS: { key: CommentSort; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

const PAGE_SIZE = 20;

function displayName(c: Comment): string {
  if (c.user?.display_name) return c.user.display_name;
  if (c.user?.username) return `@${c.user.username}`;
  return `@user_${c.user_id.slice(0, 6)}`;
}

function avatarInitial(c: Comment): string {
  const name = c.user?.display_name ?? c.user?.username ?? c.user_id.slice(0, 1);
  return (name[0] ?? '?').toUpperCase();
}

const TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;

function timestampToSeconds(ts: string): number {
  const parts = ts.split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function renderWithTimestamps(
  content: string,
  onSeek?: (seconds: number) => void,
): React.ReactNode {
  if (!onSeek) return content;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  TIMESTAMP_RE.lastIndex = 0;
  while ((m = TIMESTAMP_RE.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    const ts = m[0];
    const secs = timestampToSeconds(ts);
    parts.push(
      <span
        key={`ts-${key++}`}
        onClick={() => onSeek(secs)}
        title={`Jump to ${ts}`}
        style={{
          color: '#065fd4',
          cursor: 'pointer',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ts}
      </span>,
    );
    last = m.index + ts.length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts.length > 0 ? parts : content;
}

function CommentItem({
  comment, currentUserId, videoOwnerId, onRefresh, onSignIn, isReply = false, onSeek,
}: {
  comment: Comment;
  currentUserId: string | null;
  videoOwnerId?: string;
  onRefresh: () => void;
  onSignIn: () => void;
  isReply?: boolean;
  onSeek?: (seconds: number) => void;
}) {
  const [liked, setLiked] = useState<boolean>(!!comment.user_reaction);
  const [likeCount, setLikeCount] = useState(comment.like_count);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isOwner = !!currentUserId && currentUserId === comment.user_id;
  const isDeleted = comment.is_deleted === 1;
  const isPinned = comment.is_pinned === 1;
  const hasHeart = comment.creator_heart === 1;
  const canModerate = !!currentUserId && !!videoOwnerId && currentUserId === videoOwnerId;

  async function handleLike() {
    if (!currentUserId) { onSignIn(); return; }
    if (isDeleted) return;
    try {
      const res = await likeComment(comment.id);
      setLiked(res.liked);
      setLikeCount(res.likeCount);
    } catch {}
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUserId) { onSignIn(); return; }
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      await createComment(comment.video_id, replyText.trim(), comment.id);
      setReplyText('');
      setShowReply(false);
      setShowReplies(true);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSave() {
    if (!editText.trim()) return;
    setBusy(true);
    try {
      await updateComment(comment.id, editText.trim());
      setEditing(false);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this comment?')) return;
    setBusy(true);
    try {
      await deleteComment(comment.id);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReport(reason: string) {
    setReportReason(reason);
    try {
      await reportComment(comment.id, reason);
      setShowReport(false);
      alert('Thank you. Your report has been submitted.');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handlePinToggle() {
    if (!canModerate) return;
    setBusy(true);
    try {
      if (isPinned) await unpinComment(comment.id);
      else await pinComment(comment.id);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleHeartToggle() {
    if (!canModerate) return;
    try {
      await toggleCreatorHeart(comment.id);
      onRefresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="mf-comment" style={isReply ? { marginTop: 0 } : undefined}>
      <div
        className="mf-comment-avatar"
        style={hasHeart ? { boxShadow: '0 0 0 2px #ff4d6d' } : undefined}
      >
        {avatarInitial(comment)}
      </div>
      <div className="mf-comment-body">
        <div className="mf-comment-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="mf-comment-author">{displayName(comment)}</span>
          {canModerate && comment.user_id === videoOwnerId && (
            <span style={{ fontSize: 11, background: '#606060', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>
              Creator
            </span>
          )}
          {isPinned && (
            <span style={{ fontSize: 11, background: '#065fd4', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>
              📌 Pinned
            </span>
          )}
          <span className="mf-comment-time">{timeAgo(comment.created_at)}</span>
          {comment.is_edited === 1 && !isDeleted && (
            <span className="mf-comment-time">(edited)</span>
          )}
        </div>

        {editing ? (
          <div>
            <textarea
              className="mf-input"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              disabled={busy}
              style={{ minHeight: 60, fontSize: 14 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button className="mf-btn-text" onClick={() => { setEditing(false); setEditText(comment.content); }} disabled={busy}>Cancel</button>
              <button className="mf-btn-text mf-btn-text-primary" onClick={handleEditSave} disabled={busy || !editText.trim()}>
                {busy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`mf-comment-content ${isDeleted ? 'deleted' : ''}`}>
              {isDeleted ? '[Comment deleted]' : renderWithTimestamps(comment.content, onSeek)}
            </div>

            {hasHeart && !isDeleted && (
              <div style={{ marginTop: 4, fontSize: 13, color: '#ff4d6d' }}>💖 Loved by creator</div>
            )}

            {!isDeleted && (
              <div className="mf-comment-actions">
                <button
                  className={`mf-comment-action ${liked ? 'liked' : ''}`}
                  onClick={handleLike}
                  title={liked ? 'Unlike' : 'Like'}
                >
                  {liked ? '❤️' : '🤍'} {likeCount > 0 ? likeCount : ''}
                </button>

                {!isReply && (
                  <button
                    className="mf-comment-action"
                    onClick={() => {
                      if (!currentUserId) { onSignIn(); return; }
                      setShowReply((v) => !v);
                    }}
                  >
                    💬 Reply
                  </button>
                )}

                {!isReply && canModerate && (
                  <button
                    className="mf-comment-action"
                    onClick={handlePinToggle}
                    disabled={busy}
                    title={isPinned ? 'Unpin' : 'Pin comment'}
                  >
                    📌 {isPinned ? 'Unpin' : 'Pin'}
                  </button>
                )}

                {!isReply && canModerate && comment.user_id !== videoOwnerId && (
                  <button
                    className="mf-comment-action"
                    onClick={handleHeartToggle}
                    title={hasHeart ? 'Remove heart' : 'Heart this comment'}
                  >
                    {hasHeart ? '💖' : '🤍'} Heart
                  </button>
                )}

                <div style={{ position: 'relative' }}>
                  <button
                    className="mf-comment-action"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="More"
                  >
                    ⋮
                  </button>
                  {menuOpen && (
                    <div
                      onMouseLeave={() => setMenuOpen(false)}
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        marginTop: 4,
                        background: '#fff',
                        border: '1px solid #e5e5e5',
                        borderRadius: 8,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        minWidth: 160,
                        padding: '6px 0',
                        zIndex: 200,
                      }}
                    >
                      {isOwner && (
                        <>
                          <div
                            onClick={() => { setMenuOpen(false); setEditing(true); }}
                            style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 13 }}
                          >✏️ Edit</div>
                          <div
                            onClick={() => { setMenuOpen(false); handleDelete(); }}
                            style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 13, color: '#dc2626' }}
                          >🗑️ Delete</div>
                        </>
                      )}
                      {!isOwner && currentUserId && (
                        <div
                          onClick={() => { setMenuOpen(false); setShowReport(true); }}
                          style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 13 }}
                        >🚩 Report</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {showReply && (
              <form onSubmit={handleReplySubmit} className="mf-reply-form">
                <textarea
                  className="mf-input"
                  placeholder="Add a reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  disabled={busy}
                  style={{ minHeight: 50, fontSize: 14 }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="mf-btn-text" onClick={() => { setShowReply(false); setReplyText(''); }} disabled={busy}>Cancel</button>
                  <button type="submit" className="mf-btn-text mf-btn-text-primary" disabled={busy || !replyText.trim()}>
                    {busy ? 'Posting...' : 'Reply'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {!isReply && comment.replies && comment.replies.length > 0 && (
          <>
            <button
              className="mf-comment-replies-toggle"
              onClick={() => setShowReplies((v) => !v)}
            >
              {showReplies ? '▲' : '▼'} {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
            </button>
            {showReplies && (
              <div className="mf-comment-replies">
                {comment.replies.map((r) => (
                  <CommentItem
                    key={r.id}
                    comment={r}
                    currentUserId={currentUserId}
                    videoOwnerId={videoOwnerId}
                    onRefresh={onRefresh}
                    onSignIn={onSignIn}
                    onSeek={onSeek}
                    isReply
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showReport && (
        <div className="mf-modal-backdrop" onClick={() => setShowReport(false)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18 }}>Report comment</h2>
            <p style={{ color: '#606060', fontSize: 13, marginBottom: 20 }}>
              Why are you reporting this comment?
            </p>
            <div className="mf-report-reasons">
              {REPORT_REASONS.map((r) => (
                <div
                  key={r.key}
                  className={`mf-report-reason ${reportReason === r.key ? 'selected' : ''}`}
                  onClick={() => handleReport(r.key)}
                >
                  {r.label}
                </div>
              ))}
            </div>
            <button className="mf-btn-secondary" onClick={() => setShowReport(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommentSection({ videoId, videoOwnerId, onSignIn, onSeek }: Props) {
  const me = getCachedUser();
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<CommentSort>('top');
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function load(reset = true) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const offset = reset ? 0 : comments.length;
      const res = await listCommentsPaginated(videoId, sort, PAGE_SIZE, offset);
      setComments(reset ? res.comments : [...comments, ...res.comments]);
      setTotal(res.total);
      setHasMore(res.has_more);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [videoId, sort]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) { onSignIn(); return; }
    if (!newComment.trim()) return;
    setBusy(true);
    try {
      await createComment(videoId, newComment.trim(), null);
      setNewComment('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      await load(true);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setNewComment(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  }

  const initial = me?.username?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="mf-comments-section">
      <div className="mf-comments-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="mf-comments-count">{total} {total === 1 ? 'Comment' : 'Comments'}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className="mf-btn-text"
              onClick={() => setSort(opt.key)}
              style={{
                fontSize: 13,
                padding: '4px 10px',
                borderRadius: 16,
                background: sort === opt.key ? '#0f0f0f' : 'transparent',
                color: sort === opt.key ? '#fff' : '#0f0f0f',
                border: '1px solid #e5e5e5',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <form className="mf-comment-form" onSubmit={handleSubmit}>
        <div className="mf-comment-form-avatar">{initial}</div>
        <div className="mf-comment-input-wrap">
          <textarea
            ref={textareaRef}
            className="mf-comment-input"
            placeholder={me ? 'Add a comment...' : 'Sign in to add a comment'}
            value={newComment}
            onChange={autoResize}
            onClick={() => { if (!me) onSignIn(); }}
            disabled={busy}
            rows={1}
          />
          {newComment.trim() && (
            <div className="mf-comment-form-actions">
              <button
                type="button"
                className="mf-btn-text"
                onClick={() => { setNewComment(''); if (textareaRef.current) textareaRef.current.style.height = 'auto'; }}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="mf-btn-text mf-btn-text-primary" disabled={busy}>
                {busy ? 'Posting...' : 'Comment'}
              </button>
            </div>
          )}
        </div>
      </form>

      {loading ? (
        <div className="mf-loading">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: '#606060' }}>
          No comments yet. Be the first to comment!
        </div>
      ) : (
        <>
          <div className="mf-comment-list">
            {comments.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                currentUserId={me?.id ?? null}
                videoOwnerId={videoOwnerId}
                onRefresh={() => load(true)}
                onSignIn={onSignIn}
            onSeek={onSeek}
              />
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                className="mf-btn-secondary"
                onClick={() => load(false)}
                disabled={loadingMore}
                style={{ padding: '8px 20px', borderRadius: 20 }}
              >
                {loadingMore ? 'Loading...' : 'Load more comments'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
