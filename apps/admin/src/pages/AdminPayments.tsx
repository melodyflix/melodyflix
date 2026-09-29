import { useEffect, useState } from 'react';
import {
  listPaymentGateways, createPaymentGateway, updatePaymentGateway, deletePaymentGateway,
  listPaymentTransactions, completeTransaction,
  type PaymentGateway, type PaymentTransaction, type PaymentStats,
} from '../lib/api';

type Tab = 'gateways' | 'transactions';

const PRESETS: {
  provider: string;
  display: string;
  fields: string[];
  base: string;
  help: string;
}[] = [
  { provider: 'bkash', display: 'bKash', fields: ['api_key', 'api_secret', 'merchant_id', 'base_url'], base: 'https://tokenized.pay.bka.sh/v1.2.0-beta', help: 'bKash Merchant/Developer dashboard থেকে API Credentials নিন' },
  { provider: 'nagad', display: 'Nagad', fields: ['api_key', 'api_secret', 'merchant_id', 'base_url'], base: 'https://api.mynagad.com', help: 'Nagad Merchant Portal থেকে Merchant ID ও Keys নিন' },
  { provider: 'rocket', display: 'Rocket (DBBL)', fields: ['api_key', 'api_secret', 'merchant_id', 'base_url'], base: 'https://api.rocket.com.bd', help: 'Rocket Merchant থেকে API তথ্য নিন' },
  { provider: 'sslcommerz', display: 'SSLCommerz', fields: ['api_key', 'api_secret', 'base_url'], base: 'https://sandbox.sslcommerz.com', help: 'SSLCommerz Store ID = API Key, Password = API Secret' },
  { provider: 'stripe', display: 'Stripe', fields: ['api_key', 'api_secret'], base: '', help: 'Stripe Dashboard → Developers → API Keys (pk_live_..., sk_live_...)' },
  { provider: 'paypal', display: 'PayPal', fields: ['api_key', 'api_secret'], base: 'https://api-m.paypal.com', help: 'PayPal Developer Dashboard → Client ID + Secret' },
  { provider: 'razorpay', display: 'Razorpay', fields: ['api_key', 'api_secret'], base: 'https://api.razorpay.com', help: 'Razorpay Dashboard → API Keys' },
];

export default function AdminPayments() {
  const [tab, setTab] = useState<Tab>('gateways');
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // New gateway form
  const [showForm, setShowForm] = useState(false);
  const [preset, setPreset] = useState(0);
  const [gwDisplay, setGwDisplay] = useState(PRESETS[0].display);
  const [gwApiKey, setGwApiKey] = useState('');
  const [gwApiSecret, setGwApiSecret] = useState('');
  const [gwMerchantId, setGwMerchantId] = useState('');
  const [gwBaseUrl, setGwBaseUrl] = useState(PRESETS[0].base);
  const [gwSandbox, setGwSandbox] = useState(true);
  const [gwActive, setGwActive] = useState(true);
  const [gwDefault, setGwDefault] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [gwRes, txRes] = await Promise.all([
        listPaymentGateways().catch(() => ({ gateways: [] })),
        listPaymentTransactions().catch(() => ({ transactions: [], stats: null })),
      ]);
      setGateways(gwRes.gateways);
      setTransactions(txRes.transactions);
      setStats(txRes.stats);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function applyPreset(idx: number) {
    setPreset(idx);
    setGwDisplay(PRESETS[idx].display);
    setGwBaseUrl(PRESETS[idx].base);
    setGwApiKey('');
    setGwApiSecret('');
    setGwMerchantId('');
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setError('');
    try {
      const presetData = PRESETS[preset];
      const payload: any = {
        provider: presetData.provider,
        display_name: gwDisplay.trim(),
        api_key: gwApiKey.trim() || undefined,
        api_secret: gwApiSecret.trim() || undefined,
        sandbox: gwSandbox,
        active: gwActive,
        is_default: gwDefault,
      };
      if (presetData.fields.includes('merchant_id')) payload.merchant_id = gwMerchantId.trim() || undefined;
      if (presetData.fields.includes('base_url')) payload.base_url = gwBaseUrl.trim() || undefined;

      await createPaymentGateway(payload);
      setShowForm(false);
      setGwApiKey('');
      setGwApiSecret('');
      setGwMerchantId('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function toggleActive(gw: PaymentGateway) {
    setBusy(gw.id);
    try {
      await updatePaymentGateway(gw.id, { active: !gw.active });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function makeDefault(gw: PaymentGateway) {
    setBusy(gw.id);
    try {
      await updatePaymentGateway(gw.id, { is_default: true });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function handleDelete(gw: PaymentGateway) {
    if (!confirm(`Delete gateway "${gw.display_name}"?`)) return;
    setBusy(gw.id);
    try {
      await deletePaymentGateway(gw.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function handleComplete(tx: PaymentTransaction) {
    if (!confirm(`Mark transaction ${tx.id.slice(0, 8)} as COMPLETED? This will unlock the user's feature.`)) return;
    setBusy(tx.id);
    try {
      await completeTransaction(tx.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Payments</h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {stats && (
        <div className="mf-cards mf-mb-16">
          <div className="mf-card">
            <div className="mf-card-label">Total Revenue</div>
            <div className="mf-card-value">৳{stats.total_revenue.toFixed(2)}</div>
            <div className="mf-card-hint">All-time</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">Last 30 Days</div>
            <div className="mf-card-value">৳{stats.revenue_last_30d.toFixed(2)}</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">Transactions</div>
            <div className="mf-card-value">{stats.total_transactions}</div>
            <div className="mf-card-hint">{stats.completed_transactions} completed</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">Active Gateways</div>
            <div className="mf-card-value">{gateways.filter((g) => g.active).length}/{gateways.length}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #e5e5e5' }}>
        <button onClick={() => setTab('gateways')} className={`mf-btn ${tab === 'gateways' ? '' : 'mf-btn-secondary'}`}>
          💳 Gateways ({gateways.length})
        </button>
        <button onClick={() => setTab('transactions')} className={`mf-btn ${tab === 'transactions' ? '' : 'mf-btn-secondary'}`}>
          📋 Transactions ({transactions.length})
        </button>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {/* GATEWAYS TAB */}
      {tab === 'gateways' && (
        <>
          <div className="mf-card mf-mb-16" style={{ background: '#e7f3ff', borderColor: '#c2d9f5' }}>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <strong>ℹ️ Setup:</strong> আপনার payment gateway-র API credentials এখানে যোগ করুন।
              Real checkout কাজ করবে যখন credentials বসাবেন। এই মুহূর্তে <em>test mode</em>-এ সিস্টেম ready।
            </div>
          </div>

          {gateways.length === 0 && !showForm && (
            <div className="mf-card mf-mb-16" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Quick add:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map((p, i) => (
                  <button
                    key={p.provider}
                    onClick={() => applyPreset(i)}
                    className="mf-btn mf-btn-secondary"
                    style={{ padding: '8px 14px', fontSize: 13 }}
                  >
                    + {p.display}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mf-flex-between mf-mb-16">
            <h2 style={{ fontSize: 16 }}>Configured Gateways</h2>
            <button className="mf-btn" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ Add gateway'}
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate} className="mf-card mf-mb-16" style={{ background: '#fafbff' }}>
              <div className="mf-form-group">
                <label className="mf-label">Provider</label>
                <select
                  className="mf-input"
                  value={preset}
                  onChange={(e) => applyPreset(Number(e.target.value))}
                >
                  {PRESETS.map((p, i) => (
                    <option key={p.provider} value={i}>{p.display}</option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: '#606060', marginTop: 4 }}>
                  {PRESETS[preset].help}
                </div>
              </div>

              <div className="mf-form-group">
                <label className="mf-label">Display name</label>
                <input className="mf-input" value={gwDisplay} onChange={(e) => setGwDisplay(e.target.value)} required maxLength={100} />
              </div>

              <div className="mf-form-group">
                <label className="mf-label">
                  {PRESETS[preset].provider === 'sslcommerz' ? 'Store ID (API Key)' : 'API Key / Client ID'}
                </label>
                <input className="mf-input" value={gwApiKey} onChange={(e) => setGwApiKey(e.target.value)} placeholder="..." />
              </div>

              <div className="mf-form-group">
                <label className="mf-label">
                  {PRESETS[preset].provider === 'sslcommerz' ? 'Store Password (API Secret)' : 'API Secret / Client Secret'}
                </label>
                <input className="mf-input" type="password" value={gwApiSecret} onChange={(e) => setGwApiSecret(e.target.value)} placeholder="..." />
              </div>

              {PRESETS[preset].fields.includes('merchant_id') && (
                <div className="mf-form-group">
                  <label className="mf-label">Merchant ID</label>
                  <input className="mf-input" value={gwMerchantId} onChange={(e) => setGwMerchantId(e.target.value)} placeholder="..." />
                </div>
              )}

              {PRESETS[preset].fields.includes('base_url') && (
                <div className="mf-form-group">
                  <label className="mf-label">Base URL</label>
                  <input className="mf-input" value={gwBaseUrl} onChange={(e) => setGwBaseUrl(e.target.value)} placeholder="https://..." />
                </div>
              )}

              <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={gwSandbox} onChange={(e) => setGwSandbox(e.target.checked)} />
                  Sandbox mode
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={gwActive} onChange={(e) => setGwActive(e.target.checked)} />
                  Active
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={gwDefault} onChange={(e) => setGwDefault(e.target.checked)} />
                  Set as default
                </label>
              </div>

              <button className="mf-btn" type="submit" disabled={busy === 'create'}>
                {busy === 'create' ? 'Saving...' : 'Save gateway'}
              </button>
            </form>
          )}

          {loading ? (
            <div className="mf-card">Loading...</div>
          ) : gateways.length === 0 ? (
            <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>💳</div>
              No payment gateways configured yet. Add bKash, Nagad, Stripe, PayPal, etc.
            </div>
          ) : (
            <table className="mf-table">
              <thead>
                <tr>
                  <th>Gateway</th>
                  <th>Provider</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {gateways.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.display_name}</strong>
                      {g.is_default === 1 && (
                        <span className="mf-badge mf-badge-success" style={{ marginLeft: 8 }}>Default</span>
                      )}
                      <div style={{ fontSize: 11, color: '#606060', marginTop: 2 }}>
                        API: {g.api_key ? '•••• ' + g.api_key.slice(-6) : 'not set'}
                      </div>
                    </td>
                    <td><span className="mf-badge mf-badge-info">{g.provider}</span></td>
                    <td>
                      {g.sandbox ? (
                        <span className="mf-badge mf-badge-warning">Sandbox</span>
                      ) : (
                        <span className="mf-badge">Live</span>
                      )}
                    </td>
                    <td>
                      {g.active ? (
                        <span className="mf-badge mf-badge-success">Active</span>
                      ) : (
                        <span className="mf-badge">Paused</span>
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className="mf-btn mf-btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        disabled={busy === g.id}
                        onClick={() => toggleActive(g)}
                      >
                        {g.active ? 'Pause' : 'Activate'}
                      </button>
                      {g.is_default === 0 && g.active === 1 && (
                        <button
                          className="mf-btn mf-btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          disabled={busy === g.id}
                          onClick={() => makeDefault(g)}
                        >
                          Set default
                        </button>
                      )}
                      <button
                        className="mf-btn mf-btn-danger"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        disabled={busy === g.id}
                        onClick={() => handleDelete(g)}
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
      )}

      {/* TRANSACTIONS TAB */}
      {tab === 'transactions' && (
        <>
          {loading ? (
            <div className="mf-card">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
              No transactions yet.
            </div>
          ) : (
            <table className="mf-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Purpose</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td><code style={{ fontSize: 11 }}>{tx.id.slice(0, 12)}</code></td>
                    <td><span className="mf-badge">{tx.purpose}</span></td>
                    <td><strong>৳{tx.amount.toFixed(2)}</strong></td>
                    <td>
                      {tx.status === 'completed' ? (
                        <span className="mf-badge mf-badge-success">Completed</span>
                      ) : tx.status === 'pending' ? (
                        <span className="mf-badge mf-badge-warning">Pending</span>
                      ) : (
                        <span className="mf-badge mf-badge-danger">{tx.status}</span>
                      )}
                    </td>
                    <td className="mf-muted" style={{ fontSize: 12 }}>{new Date(tx.created_at).toLocaleString()}</td>
                    <td>
                      {tx.status === 'pending' && (
                        <button
                          className="mf-btn"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          disabled={busy === tx.id}
                          onClick={() => handleComplete(tx)}
                        >
                          Mark complete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
