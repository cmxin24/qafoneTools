import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface UpdateInfo {
  has_update: boolean;
  latest_version: string;
  current_version: string;
  release_url: string;
}

interface UpdateContextType {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  checkError: string | null;
  autoCheck: boolean;
  setAutoCheck: (v: boolean) => void;
  checkNow: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextType>({
  updateInfo: null,
  isChecking: false,
  checkError: null,
  autoCheck: true,
  setAutoCheck: () => {},
  checkNow: async () => {},
});

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [autoCheck, setAutoCheckState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('qafone-auto-check-updates');
      // Default to true when the key has never been set
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  const isCheckingRef = useRef(false);

  const setAutoCheck = (v: boolean) => {
    setAutoCheckState(v);
    try {
      localStorage.setItem('qafone-auto-check-updates', String(v));
    } catch { /* ignore */ }
  };

  const checkNow = useCallback(async () => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    setIsChecking(true);
    setCheckError(null);
    try {
      const info = await invoke<UpdateInfo>('check_for_updates');
      setUpdateInfo(info);
    } catch (e) {
      setCheckError(String(e));
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, []);

  // Auto-check once on startup with a short delay so it doesn't block app init
  useEffect(() => {
    const shouldCheck = localStorage.getItem('qafone-auto-check-updates') !== 'false';
    if (!shouldCheck) return;
    const timer = setTimeout(() => { checkNow(); }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <UpdateContext.Provider
      value={{ updateInfo, isChecking, checkError, autoCheck, setAutoCheck, checkNow }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  return useContext(UpdateContext);
}
