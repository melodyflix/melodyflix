import { useEffect, useState } from 'react';
import {
  CREW_ROLES, listVideoCredits, addVideoCredit, removeVideoCredit,
  roleLabel, roleEmoji,
  type Person,
} from '../lib/api';

interface Props {
  videoId: string;
  onToast?: (msg: string) => void;
}

export default function CastCrewEditor({ videoId, onToast }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('actor');
  const [characterName, setCharacterName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await listVideoCredits(videoId);
      setPeople(res.people);
    } catch {}
  }

  useEffect(() => { load(); }, [videoId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await addVideoCredit(videoId, {
        name: name.trim(),
        role,
        character_name: characterName.trim() || null,
      });
      setName('');
      setCharacterName('');
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setBusy(true);
    try {
      await removeVideoCredit(videoId, id);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  const isCastRole = CREW_ROLES.find((r) => r.id === role)?.isCast;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#606060', marginBottom: 10 }}>
        Add people credited in this video.
      </div>

      {/* Current people list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {people.map((p) => (
          <div key={p.id} className="mf-castcrew-edit-row">
            <span className="mf-castcrew-role-tag">
              {roleEmoji(p.role)} {roleLabel(p.role)}
            </span>
            <span style={{ flex: 1, fontWeight: 500 }}>
              {p.name}
              {p.character_name && (
                <span style={{ color: '#909090', fontWeight: 400 }}> as {p.character_name}</span>
              )}
            </span>
            <button
              className="mf-btn-text"
              onClick={() => handleRemove(p.id)}
              disabled={busy}
              style={{ color: '#dc2626', fontSize: 12 }}
              title="Remove"
            >×</button>
          </div>
        ))}
        {people.length === 0 && (
          <div style={{ fontSize: 12, color: '#909090' }}>No credits added yet.</div>
        )}
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          className="mf-input"
          placeholder="Name (e.g. Jane Doe)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          style={{ flex: '1 1 160px', padding: '8px 12px', fontSize: 13 }}
        />
        <select
          className="mf-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={busy}
          style={{ padding: '8px 12px', fontSize: 13 }}
        >
          {CREW_ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.emoji} {r.label}</option>
          ))}
        </select>
        {isCastRole && (
          <input
            className="mf-input"
            placeholder="Character (optional)"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
            disabled={busy}
            style={{ flex: '1 1 140px', padding: '8px 12px', fontSize: 13 }}
          />
        )}
        <button
          type="submit"
          className="mf-btn-text mf-btn-text-primary"
          disabled={busy || !name.trim()}
        >
          + Add
        </button>
      </form>
    </div>
  );
}
