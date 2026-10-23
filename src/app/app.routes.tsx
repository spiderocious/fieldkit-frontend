import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { LoginPage } from '@features/auth/login.page';
import { OpsPage } from '@features/ops/ops.page';
import { SyncPage } from '@features/sync-status/sync.page';
import { NewVisitPage } from '@features/visits/new-visit.page';
import { VisitDetailPage } from '@features/visits/visit-detail.page';
import { VisitsListPage } from '@features/visits/visits-list.page';
import { ROUTES } from '@shared/constants/routes';
import { useSession } from '@shared/session/session';

function RequireSession() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session) return <Navigate to={ROUTES.login} replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route path={ROUTES.ops} element={<OpsPage />} />
      <Route element={<RequireSession />}>
        <Route path={ROUTES.visits} element={<VisitsListPage />} />
        <Route path={ROUTES.newVisit} element={<NewVisitPage />} />
        <Route path="/visits/:id" element={<VisitDetailPage />} />
        <Route path={ROUTES.sync} element={<SyncPage />} />
      </Route>
      <Route path="*" element={<Navigate to={ROUTES.visits} replace />} />
    </Routes>
  );
}
