import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('缺少 React 根节点');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
