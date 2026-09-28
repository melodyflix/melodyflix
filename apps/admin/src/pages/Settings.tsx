export default function Settings() {
  return (
    <>
      <h1 className="mf-page-title">Settings</h1>

      <div className="mf-alert mf-alert-info">
        Platform settings will be configurable in a future phase.
      </div>

      <div className="mf-card mf-mb-16">
        <h3 style={{ marginBottom: 10, fontSize: 15 }}>General</h3>
        <ul style={{ marginLeft: 20, lineHeight: 2 }}>
          <li>Site name and branding</li>
          <li>Logo and favicon</li>
          <li>Default language</li>
          <li>Timezone</li>
        </ul>
      </div>

      <div className="mf-card mf-mb-16">
        <h3 style={{ marginBottom: 10, fontSize: 15 }}>Features</h3>
        <ul style={{ marginLeft: 20, lineHeight: 2 }}>
          <li>Enable / disable signup</li>
          <li>Enable / disable comments</li>
          <li>Enable / disable live streaming</li>
          <li>Enable / disable downloads</li>
        </ul>
      </div>

      <div className="mf-card">
        <h3 style={{ marginBottom: 10, fontSize: 15 }}>Storage</h3>
        <ul style={{ marginLeft: 20, lineHeight: 2 }}>
          <li>Storage backend: local / MinIO / S3</li>
          <li>Max upload size</li>
          <li>Auto-delete old videos</li>
        </ul>
      </div>
    </>
  );
}
