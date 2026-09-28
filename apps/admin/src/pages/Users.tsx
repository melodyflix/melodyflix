import { useEffect, useState } from 'react';
import { api, type User } from '../lib/api';

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listUsers();
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function changeRole(userId: string, role: string) {
    setBusy(userId);
    try {
      await api.changeUserRole(userId, role);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeUser(userId: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    setBusy(userId);
    try {
      await api.deleteUser(userId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>
          Users <span className="mf-muted" style={{ fontSize: 14 }}>({total} total)</span>
        </h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : users.length === 0 ? (
        <div className="mf-card">No users yet.</div>
      ) : (
        <table className="mf-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Display Name</th>
              <th>Role</th>
              <th>Joined</th>
              <th style={{ width: 220 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong></td>
                <td>{u.email}</td>
                <td className="mf-muted">{u.display_name ?? '—'}</td>
                <td>
                  <span className={`mf-badge ${
                    u.role === 'admin' ? 'mf-badge-warning' :
                    u.role === 'creator' ? 'mf-badge-info' : ''
                  }`}>{u.role}</span>
                </td>
                <td className="mf-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  <select
                    className="mf-input"
                    style={{ display: 'inline-block', width: 100, marginRight: 6 }}
                    value={u.role}
                    disabled={busy === u.id}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                  >
                    <option value="user">user</option>
                    <option value="creator">creator</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    className="mf-btn mf-btn-danger"
                    style={{ padding: '4px 8px' }}
                    disabled={busy === u.id}
                    onClick={() => removeUser(u.id, u.username)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
