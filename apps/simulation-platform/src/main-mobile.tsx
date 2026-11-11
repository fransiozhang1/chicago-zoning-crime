import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppMobile from './AppMobile.tsx';
import {LanguageProvider} from './i18n';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <AppMobile />
    </LanguageProvider>
  </StrictMode>,
);
