export default function Loading() {
  return (
    <div style={{
      background: '#191919',
      height: 'calc(100vh - 52px)',
      width: '100vw',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
      color: '#888',
      fontFamily: 'inherit',
    }}>
      {/* Scrollable container placeholder */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
      }}>
        Loading reader…
      </div>

      {/* Bottom bar skeleton */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100vw',
        height: '56px',
        background: '#202020',
        borderTop: '1px solid #2f2f2f',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 24px',
        zIndex: 100,
        boxSizing: 'border-box',
      }}>
        <div style={{ color: '#ffffff', fontSize: '13px', opacity: 0.5 }}>
          ← Back
        </div>
        <div style={{ color: '#888', fontSize: '13px' }}>
          Loading…
        </div>
        <div style={{ width: '80px' }} />
      </div>
    </div>
  );
}
