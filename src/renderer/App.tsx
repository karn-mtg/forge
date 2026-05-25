import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { DeckView } from './pages/DeckView';
import { AllDecks } from './pages/AllDecks';
import { Collection } from './pages/Collection';
import { Wishlist } from './pages/Wishlist';
import { Recents } from './pages/Recents';
import { Settings } from './pages/Settings';
import { Widgets } from './pages/Widgets';
import { WidgetRegistry } from './widgets/registry';
import type { WidgetDef } from './widgets/registry';
import { CardDecoratorRegistry } from './widgets/overlayRegistry';
import type { CardDecoratorDef } from './widgets/overlayRegistry';
// Register built-in overlays as a side-effect
import './widgets/builtinOverlays';

/** Persist all custom (non-readonly) widgets to the settings file. */
export async function persistCustomWidgets(): Promise<void> {
  const custom = WidgetRegistry.getCustom();
  await window.settingsAPI.set({ customWidgets: custom });
}

/** Persist all custom (non-readonly) card decorators to the settings file. */
export async function persistCustomDecorators(): Promise<void> {
  const custom = CardDecoratorRegistry.getCustom();
  await window.settingsAPI.set({ customDecorators: custom });
}

export function App() {
  // Load user-created widgets and decorators from settings into the registries on startup
  useEffect(() => {
    window.settingsAPI.get().then(s => {
      const custom = (s?.customWidgets as WidgetDef[] | undefined) || [];
      custom.forEach(w => {
        if (!WidgetRegistry.get(w.id)) {
          WidgetRegistry.register({ ...w, readonly: false });
        }
      });
      const customDec = (s?.customDecorators as CardDecoratorDef[] | undefined) || [];
      customDec.forEach(d => {
        if (!CardDecoratorRegistry.get(d.id)) {
          CardDecoratorRegistry.register({ ...d, readonly: false });
        }
      });
    }).catch((err) => { console.error('Failed to load settings on startup:', err); });
  }, []);

  return (
    <HashRouter>
      <Routes>
        {/* DeckView has its own full layout (no AppLayout sidebar) */}
        <Route path="/deck/:id" element={<DeckView />} />

        {/* All other pages share AppLayout (sidebar + sync toast) */}
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/decks" element={<AllDecks />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/recents" element={<Recents />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/widgets" element={<Widgets />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
