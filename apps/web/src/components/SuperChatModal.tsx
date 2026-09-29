import { useEffect, useState } from 'react';
import {
  getSuperChatConfig, sendSuperChat, startCheckout, verifyPayment,
  getCachedUser,
  type SuperChatConfig, type SuperChat,
} from '../lib/api';

interface Props {
  streamId: string;
  onClose: () => void;
  onSent: (sc: SuperChat) => void;
  onSignIn: () => void;
}

type Step = 'compose' | 'paying' | 'sending' | 'done';

const DEFAULT_PRESETS = [
  { amount: 50, color: '#00a32a', pinSeconds: 60, label: 'Super Chat' },
  { amount: 100, color: '#dba617', pinSeconds: 120, label: 'Super Chat' },
  { amount: 500, color: '#dc2626', pinSeconds: 300, label: 'Super Chat' },
  { amount: 1000, color: '#7c3aed', pinSeconds: 600, label: 'Super Chat Elite' },
];

export default function SuperChatModal({ streamId, onClose, onSent, onSignIn }: Props) {
  const me = getCachedUser();
  const [config, setConfig] = useState<SuperChatConfig>({
    min_amount: 50,
    presets: DEFAULT_PRESETS,
  });
  const [step, setStep] = useState<Step>('compose');
  const [amount, setAmount] = useState<number>(50);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSuperChatConfig().then(setConfig).catch(() => {});
  }, []);

  function pickPreset(amt: number) {
    setAmount(amt);
    setCustomAmount('');
  }

  function applyCustom() {
    const n = Number(customAmount);
    if (n >= config.min_amount && n <= 1000000) {
      setAmount(n);
    }
  }

  const selectedPreset = config.presets.find((p) => p.amount === amount);
  const activeColor = selectedPreset?.color ?? '#909090';
  const pinSeconds = selectedPreset?.pinSeconds ?? 0;

  function formatPin(sec: number): string {
    if (sec === 0) return 'not pinned';
    if (sec < 60) return `${sec}s pinned`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m pinned`;
    return `${Math.floor(sec / 3600)}h pinned`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) { onSignIn(); return; }
    if (!content.trim()) { setError('Message required'); return; }
    if (amount < config.min_amount) { setError(`Minimum ৳${config.min_amount}`); return; }

    setError('');
    setBusy(true);

    try {
      // Step 1: initiate checkout
      setStep('paying');
      const checkout = await startCheckout({
        purpose: 'super_chat',
        amount,
        reference_id: streamId,
        metadata: { stream_id: streamId, content: content.slice(0, 100) },
      });

      // Step 2: in real production, redirect to gateway payment page here.
      // For test mode we simulate success:
      await verifyPayment(checkout.transaction_id, 'completed', 'SC_SIM_' + Date.now());

      // Step 3: send the super chat
      setStep('sending');
      const sc = await sendSuperChat(streamId, content.trim(), amount, checkout.transaction_id);

      setStep('done');
      onSent(sc);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError((err as Error).message);
      setStep('compose');
    }
    setBusy(false);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: 24,
          width: '100%', maxWidth: 460, maxHeight: '92vh', overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>💎 Super Chat</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', fontSize: 22,
              cursor: 'pointer', padding: 4, color: '#606060',
            }}
          >
            ✕
          </button>
        </div>

        {step === 'compose' && (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: '#fef2f2', color: '#991b1b',
                padding: '8px 12px', borderRadius: 8,
                fontSize: 13, marginBottom: 12,
              }}>
                {error}
              </div>
            )}

            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Choose amount</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
              {config.presets.map((p) => (
                <button
                  key={p.amount}
                  type="button"
                  onClick={() => pickPreset(p.amount)}
                  style={{
                    padding: '12px',
                    borderRadius: 10,
                    border: `2px solid ${amount === p.amount ? p.color : '#e5e5e5'}`,
                    background: amount === p.amount ? p.color : '#fff',
                    color: amount === p.amount ? '#fff' : '#0f0f0f',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 700,
                    fontSize: 16,
                    transition: 'all 0.15s',
                  }}
                >
                  ৳{p.amount}
                </button>
              ))}
            </div>

            <div className="mf-form-group">
              <label className="mf-label">Or custom amount (min ৳{config.min_amount})</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="mf-input"
                  type="number"
                  min={config.min_amount}
                  max={1000000}
                  placeholder={`৳${config.min_amount}`}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="mf-btn-secondary"
                  style={{ width: 'auto', padding: '8px 16px' }}
                  onClick={applyCustom}
                  disabled={!customAmount}
                >
                  Use
                </button>
              </div>
            </div>

            <div className="mf-form-group">
              <label className="mf-label">Message</label>
              <textarea
                className="mf-input"
                placeholder="Write your message to the streamer..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={200}
                required
                style={{ minHeight: 80, fontSize: 14, resize: 'vertical' }}
              />
              <div style={{ fontSize: 11, color: '#909090', textAlign: 'right', marginTop: 2 }}>
                {content.length} / 200
              </div>
            </div>

            <div
              style={{
                background: '#f5f3ff',
                borderRadius: 10,
                padding: 14,
                marginBottom: 14,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <div>
                <div style={{ color: '#606060', fontWeight: 400, fontSize: 12 }}>Your message will be:</div>
                <div style={{ color: activeColor, marginTop: 4 }}>
                  {formatPin(pinSeconds)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#606060', fontWeight: 400, fontSize: 12 }}>Total</div>
                <div style={{ color: activeColor, fontSize: 20 }}>৳{amount}</div>
              </div>
            </div>

            <button
              className="mf-btn-primary"
              type="submit"
              style={{
                width: '100%',
                padding: 14,
                fontSize: 15,
                background: activeColor,
                borderColor: activeColor,
              }}
              disabled={busy || !content.trim()}
            >
              {busy ? 'Processing...' : `Pay ৳${amount} & Send`}
            </button>
          </form>
        )}

        {step === 'paying' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>💳</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Processing payment...
            </div>
            <div style={{ fontSize: 13, color: '#606060' }}>
              ৳{amount} · Test mode simulation
            </div>
          </div>
        )}

        {step === 'sending' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>💎</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Sending your Super Chat...
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#054f31' }}>
              Super Chat sent!
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
