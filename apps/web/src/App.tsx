import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { AdminPage } from './pages/AdminPage.js';
import { AssistancePage } from './pages/AssistancePage.js';
import { CompanyPage } from './pages/CompanyPage.js';
import { DiagnosticPage } from './pages/DiagnosticPage.js';
import { HomePage } from './pages/HomePage.js';
import { LegalPage } from './pages/LegalPage.js';
import { PaymentReturnPage } from './pages/PaymentReturnPage.js';
import { PhonePage } from './pages/PhonePage.js';
import { OrderPage } from './pages/OrderPage.js';
import { SessionPage } from './pages/SessionPage.js';
import { TechnicianPage } from './pages/TechnicianPage.js';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/assistance" element={<AssistancePage />} />
        <Route path="/diagnostic" element={<DiagnosticPage />} />
        <Route path="/commande/:orderId" element={<OrderPage />} />
        <Route path="/paiement" element={<PaymentReturnPage />} />
          <Route path="/telephone" element={<PhonePage />} />
        <Route path="/session" element={<SessionPage />} />
        <Route path="/technicien" element={<TechnicianPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/entreprise" element={<CompanyPage />} />
        <Route path="/cgu" element={<LegalPage doc="cgu" />} />
        <Route path="/confidentialite" element={<LegalPage doc="confidentialite" />} />
        <Route path="/mentions-legales" element={<LegalPage doc="mentions-legales" />} />
      </Route>
    </Routes>
  );
}
