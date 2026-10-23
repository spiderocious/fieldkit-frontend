import { BrowserRouter } from 'react-router-dom';

import { AppProvider } from './app.provider';
import { AppRoutes } from './app.routes';

export function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  );
}
