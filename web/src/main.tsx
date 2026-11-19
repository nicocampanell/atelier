import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { refsReady } from './refs/store';

if (import.meta.env.DEV) void import('./dev/seed');

// Saved references load from IndexedDB first: boards drop items whose reference they can't find.
void refsReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
