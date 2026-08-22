"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const INSTALL_COMPLETED_KEY = "fanzzy_pwa_install_completed";
const AUTO_CLOSE_AFTER_MS = 6 * 1000;

const hasCompletedInstall = () => {
  try {
    return window.localStorage.getItem(INSTALL_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
};

const rememberCompletedInstall = () => {
  try {
    window.localStorage.setItem(INSTALL_COMPLETED_KEY, "true");
  } catch {
    // Standalone mode still prevents the prompt on the current visit.
  }
};

const isStandaloneApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

export default function PwaInstall({ basePath = "" }: { basePath?: string }) {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const registerWorker = () => {
        void navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath || ""}/` }).catch(() => undefined);
      };
      window.addEventListener("load", registerWorker, { once: true });
      if (document.readyState === "complete") registerWorker();
    }

    const currentPath = window.location.pathname;
    if (currentPath.startsWith(`${basePath}/admin`) || currentPath === `${basePath}/vendor` || currentPath.startsWith(`${basePath}/vendor/`)) return;
    if (isStandaloneApp()) {
      rememberCompletedInstall();
      return;
    }
    if (hasCompletedInstall()) return;

    const iosDevice = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setIsIos(iosDevice);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      setVisible(true);
    };
    const handleInstalled = () => {
      rememberCompletedInstall();
      setVisible(false);
      setShowInstructions(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    const fallbackTimer = window.setTimeout(() => {
      setVisible(true);
    }, 1800);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [basePath]);

  useEffect(() => {
    if (!visible) return;
    const autoCloseTimer = window.setTimeout(() => {
      setVisible(false);
      setShowInstructions(false);
      setInstallEvent(null);
    }, AUTO_CLOSE_AFTER_MS);
    return () => window.clearTimeout(autoCloseTimer);
  }, [visible]);

  const dismiss = () => {
    setVisible(false);
    setShowInstructions(false);
  };

  const install = async () => {
    if (!installEvent) {
      setShowInstructions(true);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      rememberCompletedInstall();
      setVisible(false);
      setInstallEvent(null);
    }
  };

  if (!visible) return null;

  return (
    <aside className="pwa-install" aria-label="Install Fanzzy app">
      <button className="pwa-install-close" type="button" aria-label="Dismiss install app prompt" onClick={dismiss}>×</button>
      <img src={`${basePath}/app-icon-192.png`} alt="" />
      <div className="pwa-install-copy">
        <span>FANZZY APP</span>
        <strong>Add Fanzzy to your phone</strong>
        <small>Shop faster from your home screen.</small>
      </div>
      <button className="pwa-install-action" type="button" onClick={() => void install()}>
        {installEvent ? "Install app" : "Add to Home Screen"}
      </button>
      {showInstructions && (
        <div className="pwa-install-help" role="status">
          {isIos ? <><b>On iPhone:</b> tap Share <span aria-hidden="true">⇧</span>, then choose <b>Add to Home Screen</b>.</> : <><b>Open your browser menu</b> and choose <b>Install app</b> or <b>Add to Home screen</b>.</>}
        </div>
      )}
    </aside>
  );
}
