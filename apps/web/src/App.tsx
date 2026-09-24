import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { AdminPage } from './pages/AdminPage.js';
import { DiagnosticPage } from './pages/DiagnosticPage.js';
import { HomePage } from './pages/HomePage.js';
import { OrderPage } from './pages/OrderPage.js';
import { SessionPage } from './pages/SessionPage.js';
import { TechnicianPage } from './pages/TechnicianPage.js';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/diagnostic" element={<DiagnosticPage />} />
        <Route path="/commande/:orderId" element={<OrderPage />} />
        <Route path="/session" element={<SessionPage />} />
        <Route path="/technicien" element={<TechnicianPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
