import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getChatUsage, listAvailableGateways, startCheckout, verifyPayment,
  listMyTransactions,
  getCachedUser,
  type ChatUsage, type PublicGateway, type MyTransaction,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

type Step = 'overview' | 'gateway' | 'processing' | 'done';

export default function BuyMessages({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [gateways, setGateways] = useState<PublicGateway[]>([]);
  const [transactions, setTransactions] = useState<MyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('overview');
  const [selectedGw, setSelectedGw] = useState<string>('');
  const [txId, setTxId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [packs, setPacks] = useState<number>(1);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [u, g, t] = await Promise.all([
        getChatUsage(),
        listAvailableGateways(),
        listMyTransactions().catch(() => ({ transactions: [] })),
      ]);
      setUsage(u);
      setGateways(g.gateways);
      setTransactions(t.transactions);
      if (g.gateways.length > 0) {
        setSelectedGw(g.gateways.find((x) => x.is_default)?.id ?? g.gateways[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    load();
  }, [me]);

  async function handleCheckout() {
    if (!usage || !selectedGw) return;
    setBusy(true);
    setError('');
    try {
      const amount = usage.pack_price * packs;
      const res = await startCheckout({
        purpose: 'message_pack',
        amount,
        reference_id: `${usage.pack_size * packs}_messages`,
        gateway_id: selectedGw,
        metadata: { packs, size_per_pack: usage.pack_size },
      });
      setTxId(res.transaction_id);
      setStep('processing');

      // NOTE: In production, the frontend would redirect to gateway's payment page.
      // For now (test mode), we show a "Simulate payment" button.
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function simulatePayment() {
    if (!txId) return;
    setBusy(true);
    setError('');
    try {
      await verifyPayment(txId, 'completed', 'SIMULATED_' + Date.now());
      setStep('done');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to buy message packs</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="mf-loading">Loading...</div>;

  const totalAmount = usage ? usage.pack_price * packs : 0;
  const totalMessages = usage ? usage.pack_size * packs : 0;

  return (
    <div className="mf-container" style={{ maxWidth: 720, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#0f0f0f' }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 24, marginBottom: 0 }}>💬 Message Packs</h1>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {/* STEP: Overview */}
      {step === 'overview' && usage && (
        <>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Your current usage</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: '#606060' }}>Free messages used</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {usage.free_used} / {usage.free_limit}
                </div>
                <div style={{ fontSize: 12, color: '#00a32a', marginTop: 4 }}>
                  {usage.free_remaining} remaining
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#606060' }}>Paid balance</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#7c3aed' }}>
                  {usage.paid_balance}
                </div>
                <div style={{ fontSize: 12, color: '#909090', marginTop: 4 }}>
                  messages
                </div>
              </div>
            </div>
            {usage.requires_payment && (
              <div
                style={{
                  marginTop: 16,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#991b1b',
                }}
              >
                ⚠️ You've used all free messages. Buy a pack to keep chatting.
              </div>
            )}
          </div>

          {/* Pack selector */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              Buy message pack
            </div>
            <div style={{ fontSize: 13, color: '#606060', marginBottom: 16 }}>
              Each pack: {usage.pack_size} messages for ৳{usage.pack_price}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <button
                className="mf-btn-secondary"
                style={{ width: 44, height: 44, fontSize: 20, padding: 0 }}
                onClick={() => setPacks((p) => Math.max(1, p - 1))}
                disabled={packs <= 1}
              >
                −
              </button>
              <div style={{ fontSize: 28, fontWeight: 700, minWidth: 40, textAlign: 'center' }}>
                {packs}
              </div>
              <button
                className="mf-btn-secondary"
                style={{ width: 44, height: 44, fontSize: 20, padding: 0 }}
                onClick={() => setPacks((p) => Math.min(10, p + 1))}
                disabled={packs >= 10}
              >
                +
              </button>
              <div style={{ fontSize: 13, color: '#606060', marginLeft: 8 }}>
                pack{packs > 1 ? 's' : ''}
              </div>
            </div>

            <div
              style={{
                background: '#f5f3ff',
                padding: '12px 16px',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              <span>You get: {totalMessages} messages</span>
              <span style={{ color: '#7c3aed' }}>Total: ৳{totalAmount}</span>
            </div>
          </div>

          <button
            className="mf-btn-primary"
            style={{ width: '100%', padding: 14, fontSize: 15 }}
            onClick={() => setStep('gateway')}
          >
            Continue to payment →
          </button>
        </>
      )}

      {/* STEP: Gateway */}
      {step === 'gateway' && usage && (
        <>
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e5e5',
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>
              Choose payment method
            </div>

            {gateways.length === 0 ? (
              <div
                style={{
                  background: '#fffbea',
                  border: '1px solid #ffe8a3',
                  padding: '12px 16px',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#664d03',
                }}
              >
                ⚠️ No payment gateway is currently active. Please ask admin to configure one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gateways.map((g) => (
                  <label
                    key={g.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      border: `2px solid ${selectedGw === g.id ? '#065fd4' : '#e5e5e5'}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      background: selectedGw === g.id ? '#e8f0fe' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="gateway"
                      checked={selectedGw === g.id}
                      onChange={() => setSelectedGw(g.id)}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{g.display_name}</div>
                      <div style={{ fontSize: 12, color: '#606060' }}>
                        {g.provider}
                        {g.sandbox ? ' · Sandbox' : ''}
                        {g.is_default ? ' · Default' : ''}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              background: '#f5f3ff',
              padding: '14px 16px',
              borderRadius: 10,
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            <span>Total payment</span>
            <span style={{ color: '#7c3aed' }}>৳{totalAmount}</span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="mf-btn-secondary"
              style={{ flex: 1, padding: 14 }}
              onClick={() => setStep('overview')}
              disabled={busy}
            >
              ← Back
            </button>
            <button
              className="mf-btn-primary"
              style={{ flex: 2, padding: 14 }}
              onClick={handleCheckout}
              disabled={busy || !selectedGw || gateways.length === 0}
            >
              {busy ? 'Processing...' : `Pay ৳${totalAmount}`}
            </button>
          </div>
        </>
      )}

      {/* STEP: Processing */}
      {step === 'processing' && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 30,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>💳</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Complete payment
          </div>
          <div style={{ fontSize: 13, color: '#606060', marginBottom: 20, lineHeight: 1.6 }}>
            Transaction ID: <code>{txId.slice(0, 16)}...</code>
            <br />
            Amount: <strong>৳{totalAmount}</strong>
          </div>

          <div
            style={{
              background: '#fffbea',
              border: '1px solid #ffe8a3',
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: 12,
              textAlign: 'left',
              color: '#664d03',
              marginBottom: 20,
            }}
          >
            <strong>ℹ️ Test Mode:</strong> Payment gateway redirect will happen here once credentials are set.
            Admin panel-এ real gateway credentials বসালে স্বয়ংক্রিয়ভাবে gateway page-এ redirect হবে।
          </div>

          <button
            className="mf-btn-primary"
            style={{ width: '100%', padding: 14 }}
            onClick={simulatePayment}
            disabled={busy}
          >
            {busy ? 'Processing...' : '✓ Simulate successful payment'}
          </button>
          <button
            className="mf-btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => setStep('overview')}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      )}

      {/* STEP: Done */}
      {step === 'done' && (
        <div
          style={{
            background: '#d1fadf',
            border: '1px solid #a6e9ba',
            borderRadius: 12,
            padding: 30,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 60, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#054f31' }}>
            Payment successful!
          </div>
          <div style={{ fontSize: 14, color: '#054f31', marginBottom: 20 }}>
            {totalMessages} messages added to your balance
          </div>
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '12px 30px' }}
            onClick={() => navigate('/live')}
          >
            Start chatting →
          </button>
        </div>
      )}

      {/* Transaction history */}
      {step === 'overview' && transactions.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 20,
            marginTop: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Recent transactions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {transactions.slice(0, 5).map((tx) => (
              <div
                key={tx.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{tx.purpose.replace('_', ' ')}</div>
                  <div style={{ fontSize: 11, color: '#909090' }}>
                    {new Date(tx.created_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>৳{tx.amount}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: tx.status === 'completed' ? '#00a32a' : '#dba617',
                    }}
                  >
                    {tx.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
