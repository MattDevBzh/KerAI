import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './themes.css';
import { ZoomProvider } from './ZoomControls';
import { ThemeProvider } from './ThemePicker';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ZoomProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ZoomProvider>
  </React.StrictMode>,
);
