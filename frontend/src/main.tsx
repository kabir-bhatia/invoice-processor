import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./index.css";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/ui";
import { Dashboard } from "./screens/Dashboard";
import { Invoice } from "./screens/Invoice";
import { Queue } from "./screens/Queue";
import { Scan } from "./screens/Scan";
import { Settings } from "./screens/Settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/scan" element={<Scan />} />
          <Route element={<Shell />}>
            <Route index element={<Queue />} />
            <Route path="invoices/:id" element={<Invoice />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="settings" element={<Navigate to="/settings/rules" replace />} />
            <Route path="settings/:tab" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
