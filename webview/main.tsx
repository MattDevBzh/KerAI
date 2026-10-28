import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { deferred } from './DeferredScreen';
const DashboardWindow = deferred(() =>
  import('./DashboardUI').then((module) => module.DashboardWindow),
);
import './styles.css';
import './themes.css';
import './ergonomics.css';
import { ZoomProvider } from './ZoomControls';
import { ThemeProvider } from './ThemePicker';
import { SessionViewProvider } from './SessionViewPreference';
import { RewardProvider } from './RewardProvider';
import { SecretThemeProvider } from './SecretThemes';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ZoomProvider>
      <RewardProvider>
        <SecretThemeProvider>
          <ThemeProvider>
            <SessionViewProvider>
              {document.documentElement.dataset.studioSurface === 'control' ||
              new URLSearchParams(location.search).get('surface') === 'control' ? (
                <DashboardWindow />
              ) : (
                <App />
              )}
            </SessionViewProvider>
          </ThemeProvider>
        </SecretThemeProvider>
      </RewardProvider>
    </ZoomProvider>
  </React.StrictMode>,
);
