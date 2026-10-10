import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { AdminPage } from './pages/AdminPage.js';
import { HomePage } from './pages/HomePage.js';
import { LegalPage } from './pages/LegalPage.js';
import { PaymentReturnPage } from './pages/PaymentReturnPage.js';
import { OrderPage } from './pages/OrderPage.js';
import { SessionPage } from './pages/SessionPage.js';
import { TechnicianPage } from './pages/TechnicianPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        {/* Le site ne fait qu'informer et faire télécharger : les anciennes pages mènent à l'accueil. */}
        {['/assistance', '/demander-aide', '/diagnostic', '/telephone', '/partenaire', '/entreprise'].map((old) => (
          <Route key={old} path={old} element={<Navigate to="/" replace />} />
        ))}
        <Route path="/commande/:orderId" element={<OrderPage />} />
        <Route path="/paiement" element={<PaymentReturnPage />} />
        <Route path="/session" element={<SessionPage />} />
        <Route path="/technicien" element={<TechnicianPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/cgu" element={<LegalPage doc="cgu" />} />
        <Route path="/confidentialite" element={<LegalPage doc="confidentialite" />} />
        <Route path="/mentions-legales" element={<LegalPage doc="mentions-legales" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
