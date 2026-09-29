// melodyflix - stories bar at top of Home (Instagram-style)
import { useEffect, useState, useRef } from 'react';
import {
  listStoryGroups, getCachedUser, uploadStory,
  type StoryGroup,
} from '../lib/api';
import StoryViewer from './StoryViewer';

interface Props {
  onSignIn: () => void;
}

export default function StoryBar({ onSignIn }: Props) {
  const me = getCachedUser();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await listStoryGroups();
      setGroups(res.groups);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Refresh every 60s
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  function openViewer(index: number) {
    setViewerIndex(index);
    setViewerOpen(true);
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      alert('Please pick an image or video');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert('File must be under 50 MB');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadStory(file, undefined, (p) => setUploadProgress(p));
      await load();
    } catch (err) {
      alert((err as Error).message);
    }
    setUploading(false);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // My own group
  const myGroup = me ? groups.find((g) => g.user_id === me.id) : null;
  const otherGroups = me ? groups.filter((g) => g.user_id !== me.id) : groups;

  if (loading) return null;

  // Don't show bar if nothing to display and user is not logged in
  if (!me && groups.length === 0) return null;

  return (
    <>
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid #e5e5e5',
          background: '#fff',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          display: 'flex',
          gap: 14,
        }}
      >
        {/* Add Story / My Story button */}
        {me && (
          <div
            onClick={() => {
              if (myGroup && myGroup.stories.length > 0) {
                openViewer(groups.indexOf(myGroup));
              } else {
                fileInputRef.current?.click();
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              flexShrink: 0,
              width: 76,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: myGroup
                  ? 'conic-gradient(from 0deg, #7c3aed, #a855f7, #ec4899, #f97316, #7c3aed)'
                  : '#e5e5e5',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  fontWeight: 600,
                  color: '#7c3aed',
                  overflow: 'hidden',
                }}
              >
                {me.username?.[0]?.toUpperCase() ?? '?'}
              </div>
              {!myGroup && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#065fd4',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 'bold',
                    border: '2px solid #fff',
                  }}
                >
                  +
                </div>
              )}
              {uploading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {uploadProgress}%
                </div>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#0f0f0f',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 76,
                textAlign: 'center',
              }}
            >
              {myGroup ? 'Your story' : 'Add story'}
            </div>
          </div>
        )}

        {/* Other users' stories */}
        {otherGroups.map((g) => {
          const idx = groups.indexOf(g);
          return (
            <div
              key={g.user_id}
              onClick={() => openViewer(idx)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                flexShrink: 0,
                width: 76,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: g.has_unseen
                    ? 'conic-gradient(from 0deg, #7c3aed, #a855f7, #ec4899, #f97316, #7c3aed)'
                    : '#d4d4d4',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    fontWeight: 600,
                    color: '#7c3aed',
                    overflow: 'hidden',
                  }}
                >
                  @{g.user_id.slice(0, 1).toUpperCase()}
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#606060',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 76,
                  textAlign: 'center',
                }}
              >
                @{g.user_id.slice(0, 8)}
              </div>
            </div>
          );
        })}

        {/* Empty hint if no stories exist */}
        {me && groups.length === 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              color: '#909090',
              fontSize: 13,
              paddingLeft: 8,
            }}
          >
            No stories yet — add yours!
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={handleFilePick}
      />

      {viewerOpen && groups.length > 0 && (
        <StoryViewer
          groups={groups}
          startGroupIndex={viewerIndex}
          onClose={() => { setViewerOpen(false); load(); }}
          onSignIn={onSignIn}
        />
      )}
    </>
  );
}
