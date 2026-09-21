"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const InstallContext = createContext({ installed: false, busy: false, install: () => {} });

// Capture the prompt at route mount, even while the admin login gate is loading.
// Do not share the storefront's install-completed flag: these are separate apps.
export function AdminInstallProvider({ children }: { children: ReactNode }) {
  const promptRef = useRef<InstallPromptEvent | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const syncDisplayMode = () => setInstalled(standalone.matches || Boolean(
      (navigator as Navigator & { standalone?: boolean }).standalone,
    ));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPromptEvent;
    };
    const onInstalled = () => {
      promptRef.current = null;
      setInstalled(true);
      dialogRef.current?.close();
    };
    syncDisplayMode();
    standalone.addEventListener("change", syncDisplayMode);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      standalone.removeEventListener("change", syncDisplayMode);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (installed || busyRef.current) return;
    const prompt = promptRef.current;
    if (!prompt) {
      dialogRef.current?.showModal();
      return;
    }
    // A browser install event is single-use, including when dismissed.
    promptRef.current = null;
    busyRef.current = true;
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      dialogRef.current?.showModal();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <InstallContext.Provider value={{ installed, busy, install: () => void install() }}>
      {children}
      <dialog ref={dialogRef} className="admin-install-dialog" aria-labelledby="admin-install-title"
        onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
        <h2 id="admin-install-title">Install Fanzzy Admin</h2>
        <p>Add the admin app to your desktop or home screen. It opens directly to Admin; your usual login is still required.</p>
        <ul>
          <li><strong>Chrome or Edge:</strong> open the browser menu and choose Install app, Install page as app, or Add to Home screen. If the store app is already installed, use Create shortcut and Open as window when offered.</li>
          <li><strong>iPhone or iPad:</strong> open this admin page in Safari, tap Share, then Add to Home Screen.</li>
        </ul>
        <p className="admin-install-note">If no install option appears, open this page in a supported browser. The admin app needs an internet connection.</p>
        <button type="button" onClick={() => dialogRef.current?.close()}>Got it</button>
      </dialog>
    </InstallContext.Provider>
  );
}

export function AdminInstallButton() {
  const { installed, busy, install } = useContext(InstallContext);
  return (
    <button type="button" onClick={install} disabled={installed || busy}>
      <span className="nav-icon" aria-hidden="true">↓</span>
      {installed ? "Admin app installed" : busy ? "Installing…" : "Install Admin App"}
    </button>
  );
}
