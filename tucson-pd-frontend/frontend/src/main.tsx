import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { configureAmplify } from './config/amplify-config';

// Get root element
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Check your index.html file.');
}

const root = createRoot(rootElement);

/**
 * Initialize and render application.
 *
 * Amplify MUST be configured before the app renders — any auth calls
 * that fire on mount (e.g. getCurrentUser in AuthContext) require a
 * valid configuration to exist first.
 */
async function initializeApp() {
  try {
    await configureAmplify();
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } catch (error) {
    console.error('Failed to initialize application:', error);

    // Render a blocking error screen rather than a silent white page.
    // This most commonly happens when cognito-config.json is missing
    // from the deployed site root.
    root.render(
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '40px',
        textAlign: 'center',
        backgroundColor: '#0f172a', // match TPD slate-900 background
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          maxWidth: '560px',
          backgroundColor: '#1e293b',
          padding: '40px',
          borderRadius: '8px',
          border: '1px solid #334155',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>

          <h1 style={{
            fontSize: '22px',
            fontWeight: 'bold',
            color: '#f1f5f9',
            marginBottom: '12px'
          }}>
            TPD Records System — Initialization Failed
          </h1>

          <p style={{
            fontSize: '15px',
            color: '#94a3b8',
            marginBottom: '24px',
            lineHeight: '1.6'
          }}>
            The authentication configuration could not be loaded. This usually
            means <code style={{ color: '#7dd3fc' }}>cognito-config.json</code> is
            missing from the site root or contains invalid JSON.
          </p>

          <div style={{
            backgroundColor: '#0f172a',
            padding: '14px 16px',
            borderRadius: '4px',
            marginBottom: '28px',
            textAlign: 'left',
            border: '1px solid #334155'
          }}>
            <p style={{
              fontSize: '13px',
              color: '#cbd5e1',
              margin: 0,
              fontFamily: 'monospace',
              wordBreak: 'break-word'
            }}>
              <strong style={{ color: '#f87171' }}>Error:</strong>{' '}
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px',
                fontSize: '15px',
                fontWeight: '500',
                color: 'white',
                backgroundColor: '#2563eb',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>

            <button
              onClick={() => console.log('Initialization error:', error)}
              style={{
                padding: '10px 24px',
                fontSize: '15px',
                fontWeight: '500',
                color: '#94a3b8',
                backgroundColor: 'transparent',
                border: '1px solid #475569',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Log to Console
            </button>
          </div>

          <p style={{
            fontSize: '13px',
            color: '#475569',
            marginTop: '24px',
            marginBottom: 0
          }}>
            TPD Records Processing System — contact your system administrator if this persists.
          </p>
        </div>
      </div>
    );
  }
}

initializeApp();